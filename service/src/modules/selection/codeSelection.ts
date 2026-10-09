import { z } from "zod";
import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import { decideChoice } from "../../core/llm/openai";
import { loadPrompt } from "../../core/prompts";

export const SelectBodySchema = z.object({
  text: z.string().min(1),
  context: z.string().default(""),
});

export type SelectKind = "diagnosis" | "procedure" | "both" | "neither";

export interface PredictedCode {
  code: string;
  description: string;
  confidence: number;
  reason: string;
}

export interface SelectionResult {
  kind: SelectKind;
  kindConfidence: number;
  icd: PredictedCode[];
  cpt: PredictedCode[];
}

/** Format checks: a code that cannot exist is never shown, whatever the model says. */
const ICD_10_CM = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?$/;
const CPT = /^\d{4}[0-9FTU]$/;

const CODE_SCHEMA = {
  type: "object",
  properties: {
    codes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          description: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" },
        },
        required: ["code", "description", "confidence", "reason"],
      },
    },
  },
  required: ["codes"],
};

function message(text: string, context: string): string {
  return context ? `HIGHLIGHTED TEXT\n${text}\n\nSURROUNDING TEXT\n${context}` : `HIGHLIGHTED TEXT\n${text}`;
}

/** Diagnosis, procedure, both or neither: the Decisions API first, Gemini if it is unavailable. */
async function classify(text: string, context: string): Promise<{ kind: SelectKind; confidence: number }> {
  const cfg = getConfig().selection;
  const choices = cfg.choices.map(({ value, description }) => ({ value, description }));
  try {
    const r = await decideChoice({ name: "selection_kind", instructions: loadPrompt("D-SELECT-KIND"), choices, text: message(text, context) });
    return { kind: r.choice as SelectKind, confidence: r.confidence };
  } catch {
    const { data } = await callBlock<{ answer: SelectKind; confidence: number }>({
      blockId: "P-ICD-CODE",
      parts: [{ text: `Classify only. ${message(text, context)}\n\nANSWERS\n${choices.map((c) => `${c.value}: ${c.description}`).join("\n")}` }],
      schema: {
        type: "object",
        properties: { answer: { type: "string", enum: choices.map((c) => c.value) }, confidence: { type: "number", minimum: 0, maximum: 1 } },
        required: ["answer", "confidence"],
      },
    });
    return { kind: data.answer, confidence: data.confidence };
  }
}

async function predict(blockId: "P-ICD-CODE" | "P-CPT-CODE", text: string, context: string, valid: RegExp): Promise<PredictedCode[]> {
  const { data } = await callBlock<{ codes: PredictedCode[] }>({ blockId, parts: [{ text: message(text, context) }], schema: CODE_SCHEMA });
  return data.codes
    .map((c) => ({ ...c, code: c.code.trim().toUpperCase() }))
    .filter((c) => valid.test(c.code))
    .slice(0, getConfig().selection.max_codes);
}

/**
 * A highlighted piece of a clinical page → is it codable → ICD-10-CM and/or CPT predictions.
 * A single model call per code set for now; the full Codio engine can replace `predict` later.
 */
export async function codeSelection(rawText: string, rawContext: string): Promise<SelectionResult> {
  const cfg = getConfig().selection;
  const text = rawText.trim().slice(0, cfg.max_chars);
  const context = rawContext.trim().slice(0, cfg.context_chars);
  const none: SelectionResult = { kind: "neither", kindConfidence: 1, icd: [], cpt: [] };
  if (!cfg.enabled || text.length < cfg.min_chars) return none;

  const { kind: raw, confidence } = await classify(text, context);
  const kind: SelectKind = confidence < cfg.min_confidence ? "neither" : raw;
  if (kind === "neither") return { ...none, kindConfidence: confidence };

  const [icd, cpt] = await Promise.all([
    kind === "diagnosis" || kind === "both" ? predict("P-ICD-CODE", text, context, ICD_10_CM) : Promise.resolve([]),
    kind === "procedure" || kind === "both" ? predict("P-CPT-CODE", text, context, CPT) : Promise.resolve([]),
  ]);
  return { kind, kindConfidence: confidence, icd, cpt };
}
