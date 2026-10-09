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
export async function predictIcd(raw: Block[]): Promise<{ diagnoses: CodedDiagnosis[]; usage: Usage[]; engineError?: string }> {
  const cfg = getConfig().icd_pipeline;
  const blocks = redactBlocks(raw);
  const usage: Usage[] = [];

  const { diagnoses, usage: u1 } = await extractDiagnoses(blocks);
  usage.push(u1);
  const coded = diagnoses.map((d) => cfg.include_statuses.includes(d.status));

  const params = await mapLimit(diagnoses, cfg.param_concurrency, async (dx, i) => {
    if (!coded[i]) return null;
    try {
      const r = await predictParameters(dx, blocks);
      usage.push(r.usage);
      return r.params;
    } catch {
      return null;
    }
  });

  const units = diagnoses.map((dx, i) => (coded[i] ? toUnit(i, dx, params[i] ?? null) : null)).filter((u): u is JevUnit => u !== null);
  let results: JevResult[] = [];
  let engineError: string | undefined;
  if (units.length) {
    try {
      results = await runJev(units);
    } catch (err) {
      engineError = String(err instanceof Error ? err.message : err);
    }
  }
  const byUid = new Map(results.map((r) => [r.uid, r]));

  return {
    diagnoses: diagnoses.map((dx, i) => {
      const r = byUid.get(`dx${i}`);
      const reason = !coded[i] ? `Not coded: ${dx.status.replace("_", " ")}` : engineError ?? r?.error ?? r?.handoff?.reason ?? null;
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
