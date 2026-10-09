import { callBlock } from "../../core/llm/gemini";
import type { Usage } from "../../core/types";

export interface Block {
  heading: string;
  text: string;
}

export type DxStatus = "current" | "historical" | "uncertain" | "ruled_out";

export interface Diagnosis {
  phrase: string;
  status: DxStatus;
  /** `text` exactly as on the page (for highlighting); `cleaned` the same passage after CDI (for coding). */
  quotes: { section: string; text: string; cleaned?: string }[];
}

export interface Parameter {
  name: string;
  value: string;
  phrase: string;
}

export interface DxParameters {
  documented: Parameter[];
  missing: string[];
}

export function reportText(blocks: Block[]): string {
  return blocks
    .filter((b) => b.text.trim())
    .map((b) => `--- ${b.heading || "(no heading)"}\n${b.text}`)
    .join("\n\n");
}

const QUOTE = {
  type: "object",
  properties: { section: { type: "string" }, text: { type: "string" }, cleaned: { type: "string" } },
  required: ["section", "text", "cleaned"],
};

/**
 * Step 1: every diagnosis the report documents, with the exact phrases that state it. With a
 * CDI-cleaned copy, the model reads the cleaned report and quotes the original, because the
 * quotes are found and highlighted on the page.
 */
export async function extractDiagnoses(blocks: Block[], cleaned?: Block[]): Promise<{ diagnoses: Diagnosis[]; usage: Usage }> {
  const original = reportText(blocks);
  const read = cleaned ? reportText(cleaned) : original;
  const text = read === original ? `ORIGINAL REPORT\n${original}` : `CLEANED REPORT\n${read}\n\nORIGINAL REPORT\n${original}`;
  const { data, usage } = await callBlock<{ diagnoses: Diagnosis[] }>({
    blockId: "P-DX-EXTRACT",
    parts: [{ text }],
    schema: {
      type: "object",
      properties: {
        diagnoses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              phrase: { type: "string" },
              status: { type: "string", enum: ["current", "historical", "uncertain", "ruled_out"] },
              quotes: { type: "array", items: QUOTE },
            },
            required: ["phrase", "status", "quotes"],
          },
        },
      },
      required: ["diagnoses"],
    },
  });
  return { diagnoses: data.diagnoses, usage };
}

/** Step 2: the details that decide this diagnosis's code, and the ones the report leaves out. */
export async function predictParameters(dx: Diagnosis, blocks: Block[]): Promise<{ params: DxParameters; usage: Usage }> {
  const phrases = dx.quotes.map((q) => `- (${q.section}) ${q.cleaned || q.text}`).join("\n");
  const { data, usage } = await callBlock<DxParameters>({
    blockId: "P-DX-PARAMS",
    parts: [{ text: `DIAGNOSIS: ${dx.phrase}\nSTATUS: ${dx.status}\nPHRASES\n${phrases}\n\nREPORT\n${reportText(blocks)}` }],
    schema: {
      type: "object",
      properties: {
        documented: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, value: { type: "string" }, phrase: { type: "string" } },
            required: ["name", "value", "phrase"],
          },
        },
        missing: { type: "array", items: { type: "string" } },
      },
      required: ["documented", "missing"],
    },
  });
  return { params: data, usage };
}
