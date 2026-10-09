import { callBlock } from "../../core/llm/gemini";
import type { Usage } from "../../core/types";

export const BLOCK_ID = "P-READ-SCREEN";

const SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          text: { type: "string" },
          cut_top: { type: "boolean" },
          cut_bottom: { type: "boolean" },
          has_unreadable: { type: "boolean" },
        },
        required: ["heading", "text", "cut_top", "cut_bottom", "has_unreadable"],
      },
    },
  },
  required: ["blocks"],
};

export interface CapturedBlock {
  heading: string;
  text: string;
  cut_top?: boolean;
  cut_bottom?: boolean;
  has_unreadable?: boolean;
}

export async function runScreenRead(screenshot: string): Promise<{ blocks: CapturedBlock[]; usage: Usage }> {
  const { data, usage } = await callBlock<{ blocks: CapturedBlock[] }>({
    blockId: BLOCK_ID,
    parts: [{ image: screenshot }, { text: "Transcribe the clinical note visible in this screenshot." }],
    schema: SCHEMA,
  });
  return { blocks: data.blocks, usage };
}
