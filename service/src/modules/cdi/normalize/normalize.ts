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

/**
 * CDI, ported from the Codio engine's cleaning + CDI normalisation (p001_2): typos, abbreviations,
 * numbers, administrative noise and run-on diagnoses, without changing meaning. Diagnosis and
 * procedure extraction read the cleaned text. Blocks must already be redacted.
 */
export async function normalizeReport(blocks: Block[]): Promise<{ blocks: Block[]; confidence: number; usage: Usage }> {
  const text = blocks
    .map((b, i) => (b.text.trim() ? `BLOCK ${i} | ${b.heading || "(no heading)"}\n${b.text}` : ""))
    .filter(Boolean)
    .join("\n\n");
  const { data, usage } = await callBlock<{ blocks: { index: number; text: string }[]; confidence: number }>({
    blockId: BLOCK_ID,
    parts: [{ text: `REPORT\n${text}` }],
    schema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: { type: "object", properties: { index: { type: "integer" }, text: { type: "string" } }, required: ["index", "text"] },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["blocks", "confidence"],
    },
  });
  return { blocks: mergeCleaned(blocks, data.blocks), confidence: data.confidence, usage };
}
