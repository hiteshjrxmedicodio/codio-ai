import { callBlock } from "../../../core/llm/gemini";
import type { CareSetting, Finding, Quote, Section, Usage } from "../../../core/types";
import { CONFIDENCE_SCHEMA, QUOTE_SCHEMA, findingId, noteMessage } from "../note";

export const BLOCK_ID = "P-INC";

const SCHEMA = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: QUOTE_SCHEMA,
          missing_link: { type: "string" },
          confidence: CONFIDENCE_SCHEMA,
        },
        required: ["quote", "missing_link", "confidence"],
      },
    },
  },
  required: ["threads"],
};

interface Reply {
  threads: { quote: Quote; missing_link: string; confidence: number }[];
}

export async function runUnaddressed(sections: Section[], setting: CareSetting): Promise<{ findings: Finding[]; usage: Usage }> {
  const { data, usage } = await callBlock<Reply>({ blockId: BLOCK_ID, parts: [{ text: noteMessage(sections, setting) }], schema: SCHEMA });
  const findings = data.threads.map<Finding>((t) => ({
    id: findingId(),
    block: BLOCK_ID,
    kind: "unaddressed",
    title: t.missing_link,
    quotes: [t.quote],
    detail: {},
    confidence: t.confidence,
  }));
  return { findings, usage };
}
