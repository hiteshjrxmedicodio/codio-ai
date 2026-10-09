import { z } from "zod";
import { getConfig } from "../../core/config";
import { mapLimit } from "../../core/limit";
import { redactBlocks, redactText } from "../../core/privacy/redact";
import type { Usage } from "../../core/types";
import { extractDiagnoses, predictParameters, type Block, type Diagnosis, type DxParameters } from "./extract";
import { runJev, type JevResult, type JevTrail, type JevUnit } from "./jev";

export const PredictBodySchema = z.object({
  blocks: z.array(z.object({ heading: z.string(), text: z.string() })).min(1),
});

export interface CodedDiagnosis extends Diagnosis {
  params: DxParameters | null;
  code: string | null;
  description: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  candidates: string[];
  /** The engine's path to the code, shown when the provider opens the diagnosis. */
  trail: JevTrail | null;
}

/**
 * One diagnosis while coding runs. Diagnoses are worked on side by side, so each carries its own state:
 * reading its coding details, details read, coding, done (with its code), skipped (not a status that is
 * coded, `note` says which) or failed.
 */
export interface IcdItem {
  phrase: string;
  state: "reading" | "read" | "coding" | "done" | "skipped" | "failed";
  code?: string | null;
  note?: string;
}

/** Where coding is, shown to the provider while they wait. done/total count diagnoses within a step. */
export interface IcdStep {
  step: "cdi" | "extract" | "params" | "codes" | "done";
  /** Set by the report run, whose first step is CDI. */
  withCdi?: boolean;
  label: string;
  done?: number;
  total?: number;
  /** Every diagnosis found so far with its own state, so the card can show them all running at once. */
  items?: IcdItem[];
}

/** The engine's state: the diagnosis, its own phrases by section, and the documented parameters. */
function toUnit(i: number, dx: Diagnosis, params: DxParameters | null): JevUnit {
  const statements: Record<string, string> = {};
  for (const q of dx.quotes) statements[q.section] = statements[q.section] ? `${statements[q.section]} ${q.text}` : q.text;
  if (params?.documented.length) statements["coding details"] = params.documented.map((p) => `${p.name}: ${p.value}`).join("; ");
  // Privacy: everything sent to Jev is redacted, the same as every model call.
  for (const k of Object.keys(statements)) statements[k] = redactText(statements[k] ?? "");
  return { uid: `dx${i}`, phrase: redactText(dx.phrase), state: { diagnosis: { phrase: redactText(dx.phrase), is_active: dx.status === "current" }, statements } };
}

/**
 * Report → diagnoses with the exact phrases that state them → coding parameters per diagnosis →
 * ICD-10-CM code per diagnosis from the Jev engine. Diagnoses whose status is not coded (history,
 * ruled out, uncertain by default) are returned without a code so the provider still sees them.
 */
export async function predictIcd(
  raw: Block[],
  onStep: (s: IcdStep) => void = () => undefined,
  cleanedRaw?: Block[],
): Promise<{ diagnoses: CodedDiagnosis[]; usage: Usage[]; engineError?: string }> {
  const cfg = getConfig().icd_pipeline;
  const blocks = redactBlocks(raw);
  // The CDI-cleaned report, when the report run made one: read for meaning, never quoted.
  const cleaned = cleanedRaw ? redactBlocks(cleanedRaw) : blocks;
  const usage: Usage[] = [];

  onStep({ step: "extract", label: "Finding the diagnoses in the report" });
  const { diagnoses, usage: u1 } = await extractDiagnoses(blocks, cleaned);
  usage.push(u1);
  const coded = diagnoses.map((d) => cfg.include_statuses.includes(d.status));
  const toCode = coded.filter(Boolean).length;
  const items: IcdItem[] = diagnoses.map((d, i) =>
    coded[i] ? { phrase: d.phrase, state: "reading" } : { phrase: d.phrase, state: "skipped", note: d.status },
  );
  // A copy per step: the job keeps the last step it was given, and the items keep changing after it.
  const snapshot = () => items.map((x) => ({ ...x }));

  const paramsErrors: (string | undefined)[] = [];
  let read = 0;
  const paramsLabel = `Found ${diagnoses.length} ${diagnoses.length === 1 ? "diagnosis" : "diagnoses"}, reading coding details`;
  if (toCode) onStep({ step: "params", label: paramsLabel, done: 0, total: toCode, items: snapshot() });
  const params = await mapLimit(diagnoses, cfg.param_concurrency, async (dx, i) => {
    if (!coded[i]) return null;
    try {
      const r = await predictParameters(dx, cleaned);
      usage.push(r.usage);
      return r.params;
    } catch (err) {
      // Coding goes on without the details, but the reason is kept for the review note.
      paramsErrors[i] = `Coding details could not be read: ${err instanceof Error ? err.message : String(err)}`;
      return null;
    } finally {
      (items[i] as IcdItem).state = "read";
      onStep({ step: "params", label: paramsLabel, done: ++read, total: toCode, items: snapshot() });
    }
  });

  const units = diagnoses.map((dx, i) => (coded[i] ? toUnit(i, dx, params[i] ?? null) : null)).filter((u): u is JevUnit => u !== null);
  let results: JevResult[] = [];
  let engineError: string | undefined;
  if (units.length) {
    try {
      const codesLabel = "Choosing the ICD-10 codes";
      let landed = 0;
      for (const x of items) if (x.state !== "skipped") x.state = "coding";
      onStep({ step: "codes", label: codesLabel, done: 0, total: units.length, items: snapshot() });
      results = await runJev(units, (uid, code) => {
        const item = items[Number(uid.slice(2))];
        if (item) Object.assign(item, { state: "done", code });
        onStep({ step: "codes", label: codesLabel, done: ++landed, total: units.length, items: snapshot() });
      });
    } catch (err) {
      engineError = String(err instanceof Error ? err.message : err);
      for (const x of items) if (x.state === "coding") x.state = "failed";
    }
  }
  const byUid = new Map(results.map((r) => [r.uid, r]));

  return {
    diagnoses: diagnoses.map((dx, i) => {
      const r = byUid.get(`dx${i}`);
      const reason = !coded[i] ? `Not coded: ${dx.status.replace("_", " ")}` : engineError ?? r?.error ?? r?.handoff?.reason ?? paramsErrors[i] ?? null;
      return {
        ...dx,
        params: params[i] ?? null,
        code: r?.code ?? null,
        description: r?.description ?? null,
        needsReview: !r?.code,
        reviewReason: r?.code ? null : reason,
        candidates: r?.handoff?.candidate_codes ?? [],
        trail: r?.trail ?? null,
      };
    }),
    usage,
    engineError,
  };
}
