import { callBlock } from "../../../core/llm/gemini";
import type { CareSetting, Finding, Quote, Section, Usage } from "../../../core/types";
import { CONFIDENCE_SCHEMA, QUOTE_SCHEMA, findingId, noteMessage } from "../note";

export const BLOCK_ID = "P-VAL";

const SCHEMA = {
  type: "object",
  properties: {
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: QUOTE_SCHEMA,
          gap: { type: "string", enum: ["documentation_gap", "evidence_gap"] },
          missing_element: { type: "string" },
          supporting: { type: "array", items: QUOTE_SCHEMA },
          against: { type: "array", items: QUOTE_SCHEMA },
          description: { type: "string" },
          confidence: CONFIDENCE_SCHEMA,
        },
        required: ["quote", "gap", "missing_element", "supporting", "against", "description", "confidence"],
      },
    },
  },
  required: ["diagnoses"],
};

interface Reply {
  diagnoses: {
    quote: Quote;
    gap: "documentation_gap" | "evidence_gap";
    missing_element: string;
    supporting: Quote[];
    against: Quote[];
    description: string;
    confidence: number;
  }[];
}

/**
 * Clinical validation, ported from the Codio engine's P058: a diagnosis the provider documented
 * that the note's own evidence does not adequately show. A documentation gap means the support is
 * in the note but never tied to the diagnosis by the provider; an evidence gap means it is absent
 * or the note points against it. Both sides are kept, so the fix never leads the provider.
 */
export async function runValidation(sections: Section[], setting: CareSetting): Promise<{ findings: Finding[]; usage: Usage }> {
  const { data, usage } = await callBlock<Reply>({ blockId: BLOCK_ID, parts: [{ text: noteMessage(sections, setting) }], schema: SCHEMA });
  const findings = data.diagnoses.map<Finding>((d) => ({
    id: findingId(),
    block: BLOCK_ID,
    kind: "validation",
    title: d.description,
    quotes: [d.quote, ...d.supporting, ...d.against],
    detail: { gap: d.gap, missingElement: d.missing_element, supporting: d.supporting, against: d.against },
    confidence: d.confidence,
  }));
  return { findings, usage };
}
