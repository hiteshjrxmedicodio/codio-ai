import { callBlock } from "../../../core/llm/gemini";
import type { Usage } from "../../../core/types";
import type { Block } from "../../icd/extract";

export const BLOCK_ID = "P-CDI-NORMALIZE";

/**
 * The cleaned text back onto the blocks by index. A block the model left out, blanked or
 * numbered wrongly keeps its original text, so nothing is ever lost.
 */
export function mergeCleaned(blocks: Block[], cleaned: { index: number; text: string }[]): Block[] {
  const byIndex = new Map(cleaned.filter((c) => c.text.trim()).map((c) => [c.index, c.text.trim()]));
  return blocks.map((b, i) => ({ heading: b.heading, text: b.text.trim() ? byIndex.get(i) ?? b.text : b.text }));
}

/** `interpretation`: a pointing phrase ("as above") rewritten as the connection it makes; the provider did not write it in words. */
export const CHANGE_KINDS = ["spelling", "abbreviation", "normalization", "interpretation", "reference", "removal", "split", "copy"] as const;

/** One edit CDI made, for its trail: where, what kind, the exact text before and after, and why. */
export interface CdiChange {
  index: number;
  kind: (typeof CHANGE_KINDS)[number];
  before: string;
  after: string;
  reason: string;
}

/** Something CDI deliberately left as written (an unclear word, an ambiguous abbreviation, a reference it could not resolve). */
export interface CdiFlag {
  index: number;
  text: string;
  reason: string;
}

const entry = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props) });
const str = { type: "string" };

/**
 * The trail as it applies to the merged result: a change counts only when its block exists and was
 * actually rewritten, so the trail never describes an edit that did not reach the cleaned text.
 */
export function trailFor(blocks: Block[], cleaned: Block[], changes: CdiChange[], flags: CdiFlag[]): { changes: CdiChange[]; flags: CdiFlag[] } {
  const rewritten = (i: number) => Boolean(blocks[i] && cleaned[i] && blocks[i].text !== cleaned[i].text);
  return { changes: changes.filter((c) => rewritten(c.index) && c.before !== c.after), flags: flags.filter((f) => Boolean(blocks[f.index]) && f.text.trim()) };
}

/**
 * CDI, ported from the Codio engine's cleaning + CDI normalisation (p001_2): typos, abbreviations,
 * numbers, administrative noise, run-on diagnoses and references to other items, without changing
 * meaning, with a trail of every change. Diagnosis and
 * procedure extraction read the cleaned text. Blocks must already be redacted.
 */
export async function normalizeReport(
  blocks: Block[],
): Promise<{ blocks: Block[]; confidence: number; changes: CdiChange[]; flags: CdiFlag[]; usage: Usage }> {
  const text = blocks
    .map((b, i) => (b.text.trim() ? `BLOCK ${i} | ${b.heading || "(no heading)"}\n${b.text}` : ""))
    .filter(Boolean)
    .join("\n\n");
  const { data, usage } = await callBlock<{ blocks: { index: number; text: string }[]; changes: CdiChange[]; left_as_written: CdiFlag[]; confidence: number }>({
    blockId: BLOCK_ID,
    parts: [{ text: `REPORT\n${text}` }],
    schema: {
      type: "object",
      properties: {
        blocks: { type: "array", items: entry({ index: { type: "integer" }, text: str }) },
        changes: { type: "array", items: entry({ index: { type: "integer" }, kind: { type: "string", enum: [...CHANGE_KINDS] }, before: str, after: str, reason: str }) },
        left_as_written: { type: "array", items: entry({ index: { type: "integer" }, text: str, reason: str }) },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["blocks", "changes", "left_as_written", "confidence"],
    },
  });
  const cleaned = mergeCleaned(blocks, data.blocks);
  return { blocks: cleaned, confidence: data.confidence, ...trailFor(blocks, cleaned, data.changes, data.left_as_written), usage };
}
