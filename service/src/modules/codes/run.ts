import { redactBlocks } from "../../core/privacy/redact";
import type { Usage } from "../../core/types";
import { normalizeReport } from "../cdi/normalize/normalize";
import { predictCpt, type CptResult } from "../cpt/pipeline";
import type { Block } from "../icd/extract";
import { predictIcd, type IcdStep } from "../icd/pipeline";

export interface CodesRun {
  cdi: { blocks: Block[]; confidence: number; error?: string };
  icd: Awaited<ReturnType<typeof predictIcd>> | { error: string };
  cpt: CptResult | { error: string };
  usage: Usage[];
}

const failed = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });

/**
 * One report run: CDI cleans the report, then diagnoses → ICD-10-CM and procedures → CPT read the
 * cleaned text. The two coding paths depend only on CDI, so they run side by side. A CDI failure
 * passes the original report on; a coding failure is returned for its own card, never thrown.
 */
export async function runCodes(raw: Block[], onStep: (s: IcdStep) => void = () => undefined): Promise<CodesRun> {
  const blocks = redactBlocks(raw).map(({ heading, text }) => ({ heading, text }));
  const usage: Usage[] = [];

  // Every step says the run began with CDI, so the progress card shows that step too.
  const step = (s: IcdStep) => onStep({ ...s, withCdi: true });
  step({ step: "cdi", label: "Cleaning the report (CDI)" });
  let cdi: CodesRun["cdi"];
  try {
    const r = await normalizeReport(blocks);
    usage.push(r.usage);
    cdi = { blocks: r.blocks, confidence: r.confidence };
  } catch (err) {
    cdi = { blocks, confidence: 0, error: failed(err).error };
  }

  const [icd, cpt] = await Promise.all([predictIcd(blocks, step, cdi.blocks).catch(failed), predictCpt(cdi.blocks).catch(failed)]);
  if ("usage" in icd) usage.push(...icd.usage);
  if ("usage" in cpt) usage.push(...cpt.usage);
  return { cdi, icd, cpt, usage };
}
