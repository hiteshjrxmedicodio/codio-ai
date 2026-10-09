import type { CareSetting, Finding, Section, Suggestion } from "../core/types";
import { agentTurn } from "../modules/agent/agent";
import { runFix } from "../modules/cdi/fix/fix";
import { FINDERS } from "../modules/cdi/finders";
import { runGate } from "../modules/cdi/gate/gate";
import { analyzeNote } from "../modules/cdi/pipeline/analyze";
import { runCodeScreen } from "../modules/cdi/screen/codeScreen";
import { checkPage } from "../modules/page/pageCheck";
import { runScreenRead } from "../modules/reading/screenRead";
import { runSectionMap } from "../modules/reading/sectionMap";
import { structureTranscript } from "../modules/dictation/dictation";
import { transcribeAndClean } from "../modules/voice/voice";
import { extractProcedures } from "../modules/cpt/extract";
import { predictCpt } from "../modules/cpt/pipeline";
import { extractDiagnoses } from "../modules/icd/extract";
import { normalizeReport } from "../modules/cdi/normalize/normalize";
import { runCodes } from "../modules/codes/run";
import { readChart, readImageBase64, readJson } from "./chartFile";

/** Everything a single block run can take from the command line. */
export interface BlockInput {
  chart?: string;
  setting?: CareSetting;
  image?: string;
  audio?: string;
  message?: string;
  finding?: string;
  suggestion?: string;
}

function sectionsOf(input: BlockInput): Section[] {
  if (input.chart) return readChart(input.chart);
  throw new Error("This block needs --chart <file> (a note exported from your application)");
}

function need<T>(value: T | undefined, flag: string): T {
  if (value === undefined) throw new Error(`This block needs ${flag}`);
  return value;
}

const blocksOf = (i: BlockInput) => sectionsOf(i).map((s) => ({ heading: s.name, text: s.text }));

const chartText = (i: BlockInput) => sectionsOf(i).map((s) => `${s.name}\n${s.text}`).join("\n\n");

/** Block id → how to run it alone, for debugging one prompt on a real note. Used by `pnpm block`. */
export const RUNNERS: Record<string, (input: BlockInput) => Promise<unknown>> = {
  ...Object.fromEntries(
    Object.entries(FINDERS).map(([id, fn]) => [id, (i: BlockInput) => fn(sectionsOf(i), i.setting ?? "unknown")]),
  ),
  "P-GATE": (i) => runGate(readJson<Finding>(need(i.finding, "--finding <json>")), sectionsOf(i), i.setting ?? "unknown"),
  "P-FIX": (i) => runFix(readJson<Suggestion>(need(i.suggestion, "--suggestion <json>")), sectionsOf(i), i.setting ?? "unknown"),
  "P-PAGE-CHECK": (i) => checkPage({ text: i.chart ? chartText(i) : undefined, screenshot: i.image ? readImageBase64(i.image) : undefined }),
  "P-READ-SCREEN": (i) => runScreenRead(readImageBase64(need(i.image, "--image <file>"))),
  "P-READ-MAP": (i) => runSectionMap(sectionsOf(i).map((s) => ({ heading: s.name === "other" ? "" : s.name, text: s.text }))),
  "P-VOICE-CLEAN": (i) => transcribeAndClean(readImageBase64(need(i.audio, "--audio <file>")), "audio/webm"),
  "P-DICT-REPORT": (i) => structureTranscript(chartText(i)),
  "P-AGENT": (i) =>
    agentTurn({
      history: [],
      userText: need(i.message, "--message <text>"),
      observation: {
        url: "file://cli",
        title: "CLI",
        gate: { status: "clinical", kind: i.setting ?? "unknown", setting: i.setting ?? "unknown" },
        blocks: sectionsOf(i).map((s) => ({ heading: s.name, text: s.text })),
      },
    }),
  "P-PROC-EXTRACT": (i) => extractProcedures(blocksOf(i)),
  // Selection needs retrieved candidates, so it runs as the whole pipeline.
  "P-CPT-SELECT": (i) => predictCpt(blocksOf(i)),
  "P-DX-EXTRACT": (i) => extractDiagnoses(blocksOf(i)),
  "P-CDI-NORMALIZE": (i) => normalizeReport(blocksOf(i)),
  "CODES-RUN": (i) => runCodes(blocksOf(i)),
  "CODE-SCREEN": async (i) => runCodeScreen(sectionsOf(i), i.setting ?? "unknown"),
  ANALYZE: (i) => analyzeNote(sectionsOf(i), i.setting ?? "unknown"),
};
