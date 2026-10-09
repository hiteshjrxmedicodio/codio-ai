import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import { decide } from "../../core/llm/openai";
import { loadPrompt } from "../../core/prompts";
import type { Usage } from "../../core/types";
import type { Procedure } from "./extract";
import type { Candidate } from "./rerank";

export const BLOCK_ID = "P-CPT-SELECT";

export interface ToCode {
  index: number;
  proc: Procedure;
  candidates: Candidate[];
}

export interface Selection {
  index: number;
  code: string;
  description: string;
  confidence: number;
  rationale: string;
  source: "decisions" | "P-CPT-SELECT";
}

const SCHEMA = {
  type: "object",
  properties: {
    selections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          procedure_index: { type: "integer" },
          code: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
        },
        required: ["procedure_index", "code", "confidence", "rationale"],
      },
    },
  },
  required: ["selections"],
};

const procLine = (t: ToCode) =>
  `PROCEDURE ${t.index}: ${t.proc.procedure_text}\nDETAILS: approach=${t.proc.approach || "N/A"}; laterality=${t.proc.laterality}; quantity=${t.proc.quantity}`;

const descriptorOf = (t: ToCode, code: string) => t.candidates.find((c) => c.code === code.trim().toUpperCase())?.descriptor ?? "";

/** Fallback: every remaining procedure with its own candidates in one Gemini call, matched back by index. */
async function viaGemini(items: ToCode[], report: string): Promise<{ selections: Selection[]; usage: Usage }> {
  const procedures = items
    .map((t) => `${procLine(t)}\nCANDIDATES\n${t.candidates.map((c) => `${c.code}: ${c.descriptor}`).join("\n")}`)
    .join("\n\n");
  const { data, usage } = await callBlock<{ selections: { procedure_index: number; code: string; confidence: number; rationale: string }[] }>({
    blockId: BLOCK_ID,
    parts: [{ text: `REPORT\n${report}\n\nPROCEDURES TO CODE\n${procedures}` }],
    schema: SCHEMA,
  });
  const byIndex = new Map(items.map((t) => [t.index, t]));
  const selections = data.selections.flatMap((s) => {
    const t = byIndex.get(s.procedure_index);
    if (!t || !s.code.trim()) return [];
    const code = s.code.trim().toUpperCase();
    return [{ index: t.index, code, description: descriptorOf(t, code), confidence: Math.min(1, Math.max(0, s.confidence)), rationale: s.rationale, source: BLOCK_ID } as Selection];
  });
  return { selections, usage };
}

/**
 * One code per procedure from its own candidates. A pick-one question per procedure, so the
 * Decisions API answers them all in one request; Gemini answers whatever it errors on or refuses.
 */
export async function selectCodes(items: ToCode[], report: string): Promise<{ selections: Selection[]; usage: Usage[] }> {
  const out: Selection[] = [];
  if (getConfig().cpt_pipeline.select_provider === "openai_decisions") {
    try {
      const answers = await decide({
        text: `REPORT\n${report}`,
        questions: items.map((t) => ({
          type: "choice" as const,
          name: `procedure_${t.index}`,
          instructions: `${loadPrompt(BLOCK_ID)}\n\n${procLine(t)}`,
          choices: t.candidates.map((c) => ({ value: c.code, description: c.descriptor || c.code })),
        })),
      });
      for (const t of items) {
        const a = answers.get(`procedure_${t.index}`);
        if (!a || a.refused || !a.choice) continue;
        out.push({ index: t.index, code: a.choice, description: descriptorOf(t, a.choice), confidence: a.confidence ?? 0, rationale: "", source: "decisions" });
      }
    } catch {
      // Decisions unavailable: everything falls back to Gemini below.
    }
  }
  const done = new Set(out.map((s) => s.index));
  const rest = items.filter((t) => !done.has(t.index));
  if (!rest.length) return { selections: out, usage: [] };
  const g = await viaGemini(rest, report);
  return { selections: [...out, ...g.selections], usage: [g.usage] };
}
