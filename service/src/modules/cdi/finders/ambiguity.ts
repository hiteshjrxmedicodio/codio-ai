import { callBlock } from "../../../core/llm/gemini";
import type { CareSetting, Finding, Quote, Section, Usage } from "../../../core/types";
import { CONFIDENCE_SCHEMA, QUOTE_SCHEMA, findingId, noteMessage } from "../note";

export const BLOCK_ID = "P-AMB";

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: QUOTE_SCHEMA,
          undecided: { type: "string" },
          conclusions_depend: { type: "boolean" },
          confidence: CONFIDENCE_SCHEMA,
        },
        required: ["quote", "undecided", "conclusions_depend", "confidence"],
      },
    },
  },
  required: ["items"],
};

interface Reply {
  items: { quote: Quote; undecided: string; conclusions_depend: boolean; confidence: number }[];
}

export async function runAmbiguity(sections: Section[], setting: CareSetting): Promise<{ findings: Finding[]; usage: Usage }> {
  const { data, usage } = await callBlock<Reply>({ blockId: BLOCK_ID, parts: [{ text: noteMessage(sections, setting) }], schema: SCHEMA });
  const findings = data.items.map<Finding>((i) => ({
    id: findingId(),
    block: BLOCK_ID,
    kind: "ambiguity",
    title: i.undecided,
    quotes: [i.quote],
    detail: { conclusionsDepend: i.conclusions_depend },
    confidence: i.confidence,
  }));
  return { findings, usage };
}
