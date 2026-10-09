import { callBlock } from "../../../core/llm/gemini";
import type { CareSetting, Finding, Quote, Section, Usage } from "../../../core/types";
import { CONFIDENCE_SCHEMA, QUOTE_SCHEMA, findingId, noteMessage } from "../note";

export const BLOCK_ID = "P-WRD";

const SCHEMA = {
  type: "object",
  properties: {
    slips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: QUOTE_SCHEMA,
          literal_reading: { type: "string" },
          supported_reading: { type: "string" },
          confidence: CONFIDENCE_SCHEMA,
        },
        required: ["quote", "literal_reading", "supported_reading", "confidence"],
      },
    },
  },
  required: ["slips"],
};

interface Reply {
  slips: { quote: Quote; literal_reading: string; supported_reading: string; confidence: number }[];
}

export async function runWording(sections: Section[], setting: CareSetting): Promise<{ findings: Finding[]; usage: Usage }> {
  const { data, usage } = await callBlock<Reply>({ blockId: BLOCK_ID, parts: [{ text: noteMessage(sections, setting) }], schema: SCHEMA });
  const findings = data.slips.map<Finding>((s) => ({
    id: findingId(),
    block: BLOCK_ID,
    kind: "wording",
    title: `Reads as: ${s.literal_reading} Context supports: ${s.supported_reading}`,
    quotes: [s.quote],
    detail: { literalReading: s.literal_reading, supportedReading: s.supported_reading },
    confidence: s.confidence,
  }));
  return { findings, usage };
}
