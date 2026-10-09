import { z } from "zod";
import { getConfig } from "../../core/config";
import { mapLimit } from "../../core/limit";
import { redactBlocks, redactText } from "../../core/privacy/redact";
import type { Usage } from "../../core/types";
import { extractDiagnoses, predictParameters, type Block, type Diagnosis, type DxParameters } from "./extract";
import { HISTORY_NOTE, asHistoryPhrase, baseUid, codeHistory, historyUid, pickHistory } from "./history";
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

/**
 * The engine's state: the diagnosis, its own phrases by section, and the documented parameters. A
 * historical diagnosis gets two units (history.ts): as written, and as personal history.
 */
function toUnit(i: number, dx: Diagnosis, params: DxParameters | null, asHistory = false): JevUnit {
  const history = dx.status === "historical";
  const phrase = asHistory ? asHistoryPhrase(dx.phrase) : dx.phrase;
  const statements = statementsOf(dx, params);
  if (history) statements["status"] = redactText(HISTORY_NOTE);
  return { uid: asHistory ? historyUid(`dx${i}`) : `dx${i}`, phrase: redactText(phrase), state: { diagnosis: { phrase: redactText(phrase), is_active: !history }, statements } };
}

/** The report's own words about the diagnosis by section, plus its coding details; redacted like every model call. */
function statementsOf(dx: Diagnosis, params: DxParameters | null): Record<string, string> {
  const statements: Record<string, string> = {};
  for (const q of dx.quotes) statements[q.section] = statements[q.section] ? `${statements[q.section]} ${q.text}` : q.text;
  if (params?.documented.length) statements["coding details"] = params.documented.map((p) => `${p.name}: ${p.value}`).join("; ");
  for (const k of Object.keys(statements)) statements[k] = redactText(statements[k] ?? "");
  return statements;
}

/**
 * Report → diagnoses with the exact phrases that state them → coding parameters per diagnosis →
 * ICD-10-CM code per diagnosis from the Jev engine. Current and historical diagnoses are coded (history
 * in its personal-history or old/sequela form); statuses left out of `include_statuses` (ruled out and
 * uncertain by default) are returned without a code so the provider still sees them.
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

  const codesLabel = "Choosing the ICD-10 codes";
  let landed = 0;
  for (const x of items) if (x.state !== "skipped") x.state = "coding";
  onStep({ step: "codes", label: codesLabel, done: 0, total: toCode, items: snapshot() });

  // History first, straight from the tabular's history-form codes; what it cannot place goes to the engine.
  const direct = new Map<number, JevResult>();
  await mapLimit(diagnoses, cfg.param_concurrency, async (dx, i) => {
    if (!coded[i] || dx.status !== "historical") return;
    const r = await codeHistory(`dx${i}`, dx, statementsOf(dx, params[i] ?? null)).catch(() => null);
    if (!r) return;
    direct.set(i, r);
    Object.assign(items[i] as IcdItem, { state: "done", code: r.code });
    onStep({ step: "codes", label: codesLabel, done: ++landed, total: toCode, items: snapshot() });
  });

  const units: JevUnit[] = [];
  diagnoses.forEach((dx, i) => {
    if (!coded[i] || direct.has(i)) return;
    units.push(toUnit(i, dx, params[i] ?? null));
    if (dx.status === "historical") units.push(toUnit(i, dx, params[i] ?? null, true));
  });
  let results: JevResult[] = [];
  let engineError: string | undefined;
  // A historical diagnosis the engine walked is done when both its walks are; its code is the pick of the two.
  const resultFor = (i: number, by: Map<string, JevResult>): JevResult | undefined =>
    direct.get(i) ?? (diagnoses[i]?.status === "historical" ? pickHistory(by.get(`dx${i}`), by.get(historyUid(`dx${i}`)), diagnoses[i]?.phrase ?? "") : by.get(`dx${i}`));
  if (units.length) {
    try {
      const partial = new Map<string, JevResult>();
      results = await runJev(units, (uid, code, description) => {
        partial.set(uid, { uid, code, description });
        const i = Number(baseUid(uid).slice(2));
        const item = items[i];
        if (!item || (diagnoses[i]?.status === "historical" && !(partial.has(`dx${i}`) && partial.has(historyUid(`dx${i}`))))) return;
        Object.assign(item, { state: "done", code: resultFor(i, partial)?.code ?? null });
        onStep({ step: "codes", label: codesLabel, done: ++landed, total: toCode, items: snapshot() });
      });
    } catch (err) {
      engineError = String(err instanceof Error ? err.message : err);
      for (const x of items) if (x.state === "coding") x.state = "failed";
    }
  }
  const byUid = new Map(results.map((r) => [r.uid, r]));

  return {
    diagnoses: diagnoses.map((dx, i) => {
      const r = resultFor(i, byUid);
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
