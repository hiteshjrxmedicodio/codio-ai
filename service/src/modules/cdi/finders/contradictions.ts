import { callBlock } from "../../../core/llm/gemini";
import type { CareSetting, Finding, Section, Usage } from "../../../core/types";
import { CONFIDENCE_SCHEMA, QUOTE_SCHEMA, findingId, noteMessage } from "../note";

export const BLOCK_ID = "P-CON";

const SCHEMA = {
  type: "object",
  properties: {
    conflicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote_a: QUOTE_SCHEMA,
          quote_b: QUOTE_SCHEMA,
          aspect: { type: "string" },
          description: { type: "string" },
          confidence: CONFIDENCE_SCHEMA,
        },
        required: ["quote_a", "quote_b", "aspect", "description", "confidence"],
      },
    },
  },
  required: ["conflicts"],
};

interface Reply {
  conflicts: { quote_a: Finding["quotes"][0]; quote_b: Finding["quotes"][0]; aspect: string; description: string; confidence: number }[];
}

export async function runContradictions(sections: Section[], setting: CareSetting): Promise<{ findings: Finding[]; usage: Usage }> {
  const { data, usage } = await callBlock<Reply>({ blockId: BLOCK_ID, parts: [{ text: noteMessage(sections, setting) }], schema: SCHEMA });
  const findings = data.conflicts.map<Finding>((c) => ({
    id: findingId(),
    block: BLOCK_ID,
    kind: "contradiction",
    title: c.description,
    quotes: [c.quote_a, c.quote_b],
    detail: { aspect: c.aspect },
    confidence: c.confidence,
  }));
  return { findings, usage };
}
