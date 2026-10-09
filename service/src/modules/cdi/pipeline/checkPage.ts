import type { AnalyzeResult, CareSetting, Section } from "../../../core/types";
import { readFromBlocks, readFromScreens } from "../../reading/read";
import type { CapturedBlock } from "../../reading/screenRead";
import { analyzeNote } from "./analyze";

export interface PageContent {
  blocks?: CapturedBlock[];
  screenshots?: string[];
}

export interface PageCheckResult extends AnalyzeResult {
  sections: Section[];
  /** The same summary the agent model receives, so the extension can pass it back on later turns. */
  summary: string;
}

/** Whatever the extension captured → standard sections → the CDI pipeline. */
export async function checkPageContent(content: PageContent, setting: CareSetting): Promise<PageCheckResult> {
  const read = content.blocks?.some((b) => b.text.trim())
    ? await readFromBlocks(content.blocks)
    : await readFromScreens(content.screenshots ?? []);
  if (!read.sections.length) throw new Error("Nothing readable was captured from this page");
  const result = await analyzeNote(read.sections, setting);
  return { ...result, sections: read.sections, summary: summariseForAgent(result), usage: [...read.usage, ...result.usage] };
}

/** What the agent model sees about a check: short, quotable, no internal ids. */
export function summariseForAgent(result: AnalyzeResult): string {
  if (!result.suggestions.length) return "The documentation check found nothing critical to show the provider.";
  const lines = result.suggestions.map((s, i) => {
    const quotes = s.quotes.map((q) => `${q.section}: ${q.text}`).join(" | ");
    return `${i + 1}. [${s.gate.answer}, ${s.kind}] ${s.title}${quotes ? ` (quotes: ${quotes})` : ""}`;
  });
  return `The documentation check found ${result.suggestions.length} critical item(s), shown to the provider as cards:\n${lines.join("\n")}`;
}
