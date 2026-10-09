import { redactBlocks } from "../../core/privacy/redact";
import type { Usage } from "../../core/types";
import { normalizeReport } from "../cdi/normalize/normalize";
import { predictCpt, type CptResult } from "../cpt/pipeline";
import type { Block } from "../icd/extract";
import { predictIcd, type IcdStep } from "../icd/pipeline";

export interface CodesRun {
  /** `changed`: indexes of the blocks CDI rewrote; the rest came back as they were. */
  cdi: { blocks: Block[]; confidence: number; changed: number[]; error?: string };
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
export async function runCodes(
  raw: Block[],
  onStep: (s: IcdStep) => void = () => undefined,
  onPart: (key: "cdi" | "icd" | "cpt", value: unknown) => void = () => undefined,
): Promise<CodesRun> {
  const blocks = redactBlocks(raw).map(({ heading, text }) => ({ heading, text }));
  const usage: Usage[] = [];

  onStep({ step: "cdi", label: "Cleaning the report (CDI)" });
  let cdi: CodesRun["cdi"];
  try {
    const r = await normalizeReport(blocks);
    usage.push(r.usage);
    cdi = { blocks: r.blocks, confidence: r.confidence, changed: r.blocks.flatMap((b, i) => (b.text !== blocks[i]?.text ? [i] : [])) };
  } catch (err) {
    cdi = { blocks, confidence: 0, changed: [], error: failed(err).error };
  }

  // CDI's card can fill now; ICD and CPT each report the moment they settle, not when both do.
  onPart("cdi", cdi);
  const report = <T>(key: "icd" | "cpt", r: T) => (onPart(key, r), r);
  const [icd, cpt] = await Promise.all([
    predictIcd(blocks, onStep, cdi.blocks).catch(failed).then((r) => report("icd", r)),
    predictCpt(cdi.blocks).catch(failed).then((r) => report("cpt", r)),
  ]);
  if ("usage" in icd) usage.push(...icd.usage);
  if ("usage" in cpt) usage.push(...cpt.usage);
  return { cdi, icd, cpt, usage };
}
