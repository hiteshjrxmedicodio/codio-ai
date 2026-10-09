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

const CHANGE_TYPES = ["spelling", "grammar", "abbreviation", "format", "removal", "structure"];

/** One change preprocessing made: the text before and after. */
export interface Correction {
  index: number;
  type: string;
  original: string;
  corrected: string;
}

/** Text preprocessing left as written because the report did not settle it; the review reads these. */
export interface Unsettled {
  index: number;
  type: string;
  text: string;
  reason: string;
}

/**
 * Preprocessing, ported from the Codio engine's record standardization (p001_2 and the inpatient
 * p060): spelling, grammar, abbreviations, formats, administrative noise and run-on diagnoses, made
 * correct without changing meaning. It owns every writing correction, so the documentation review
 * never reports one. Diagnosis and procedure extraction read the corrected text. Each change and each
 * item left unsettled is returned. Blocks must already be redacted.
 */
export async function normalizeReport(
  blocks: Block[],
): Promise<{ blocks: Block[]; corrections: Correction[]; unsettled: Unsettled[]; confidence: number; usage: Usage }> {
  const text = blocks
    .map((b, i) => (b.text.trim() ? `BLOCK ${i} | ${b.heading || "(no heading)"}\n${b.text}` : ""))
    .filter(Boolean)
    .join("\n\n");
  const { data, usage } = await callBlock<{ blocks: { index: number; text: string }[]; corrections: Correction[]; unsettled: Unsettled[]; confidence: number }>({
    blockId: BLOCK_ID,
    parts: [{ text: `REPORT\n${text}` }],
    schema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: { type: "object", properties: { index: { type: "integer" }, text: { type: "string" } }, required: ["index", "text"] },
        },
        corrections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              type: { type: "string", enum: CHANGE_TYPES },
              original: { type: "string" },
              corrected: { type: "string" },
            },
            required: ["index", "type", "original", "corrected"],
          },
        },
        unsettled: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              type: { type: "string", enum: [...CHANGE_TYPES, "clinical", "consistency"] },
              text: { type: "string" },
              reason: { type: "string" },
            },
            required: ["index", "type", "text", "reason"],
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["blocks", "corrections", "unsettled", "confidence"],
    },
  });
  return {
    blocks: mergeCleaned(blocks, data.blocks),
    corrections: data.corrections ?? [],
    unsettled: data.unsettled ?? [],
    confidence: data.confidence,
    usage,
  };
}
