import { getConfig } from "../../core/config";
import { redactBlocks } from "../../core/privacy/redact";
import { isHistorySection } from "../../core/sections";
import type { Usage } from "../../core/types";
import { normalizeReport, type CdiChange, type CdiFlag } from "../cdi/normalize/normalize";
import { predictCpt, type CptResult } from "../cpt/pipeline";
import type { Block } from "../icd/extract";
import { predictIcd, type IcdStep } from "../icd/pipeline";

export interface CodesRun {
  /** `changed`: indexes of the blocks CDI rewrote; `changes` and `flags`: its trail, what it changed and left as written. */
  cdi: { blocks: Block[]; confidence: number; changed: number[]; changes: CdiChange[]; flags: CdiFlag[]; error?: string };
  /** `skipped`: that part is turned off in config.yaml (report_run), so the run stopped after CDI for it. */
  icd: Awaited<ReturnType<typeof predictIcd>> | { error: string } | { skipped: string };
  cpt: CptResult | { error: string } | { skipped: string };
  usage: Usage[];
}

const failed = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });

/**
 * One report run: CDI cleans the report, then diagnoses → ICD-10-CM and procedures → CPT read the
 * cleaned text, without its history sections. The two coding paths depend only on CDI, so they run side by side. A CDI failure
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
    cdi = { blocks: r.blocks, confidence: r.confidence, changes: r.changes, flags: r.flags, changed: r.blocks.flatMap((b, i) => (b.text !== blocks[i]?.text ? [i] : [])) };
  } catch (err) {
    cdi = { blocks, confidence: 0, changed: [], changes: [], flags: [], error: failed(err).error };
  }

  // CDI's card can fill now; ICD and CPT each report the moment they settle, not when both do.
  onPart("cdi", cdi);
  // History sections are not this encounter: neither coding path reads them (core/sections.ts).
  const keep = blocks.map((b) => !isHistorySection(b.heading));
  const coded = blocks.filter((_, i) => keep[i]);
  const codedClean = cdi.blocks.filter((_, i) => keep[i]);
  const report = <T>(key: "icd" | "cpt", r: T) => (onPart(key, r), r);
  const on = getConfig().report_run;
  const off = (key: "icd" | "cpt") => Promise.resolve({ skipped: `Turned off (report_run.${key} in config.yaml)` });
  const [icd, cpt] = await Promise.all([
    (on.icd ? predictIcd(coded, onStep, codedClean).catch(failed) : off("icd")).then((r) => report("icd", r)),
    (on.cpt ? predictCpt(codedClean).catch(failed) : off("cpt")).then((r) => report("cpt", r)),
  ]);
  if ("usage" in icd) usage.push(...icd.usage);
  if ("usage" in cpt) usage.push(...cpt.usage);
  return { cdi, icd, cpt, usage };
}
