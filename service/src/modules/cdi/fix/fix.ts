import { callBlock } from "../../../core/llm/gemini";
import type { CareSetting, Section, Suggestion, Usage } from "../../../core/types";
import { findingMessage } from "../gate/gate";

export const BLOCK_ID = "P-FIX";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    guidance: { type: "string" },
    choices: { type: "array", items: { type: "string" }, minItems: 2 },
  },
  required: ["title", "guidance", "choices"],
};

export interface FixReply {
  title: string;
  guidance: string;
  choices: string[];
}

/** Runs only after a provider gives a suggestion a thumbs up. */
export async function runFix(suggestion: Suggestion, sections: Section[], setting: CareSetting): Promise<{ fix: FixReply; usage: Usage }> {
  const text = `${findingMessage(suggestion, sections, setting)}\n\nJUDGED CRITICAL BECAUSE: ${suggestion.gate.answer}. ${suggestion.gate.reason}`;
  const { data, usage } = await callBlock<FixReply>({ blockId: BLOCK_ID, parts: [{ text }], schema: SCHEMA });
  return { fix: data, usage };
}
