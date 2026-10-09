import { getConfig } from "../../core/config";
import { callBlock, type InputPart } from "../../core/llm/gemini";
import { decideChoice } from "../../core/llm/openai";
import { loadPrompt } from "../../core/prompts";
import type { Usage } from "../../core/types";

export const BLOCK_ID = "P-PAGE-CHECK";

export type GateStatus = "clinical" | "not_clinical";

export interface PageGate {
  status: GateStatus;
  kind: string;                 // the chosen value from page_check.choices
  setting: "operative" | "enm" | "inpatient" | "unknown" | "none";
  confidence: number;
  provider: "openai_decisions" | "gemini";
  note?: string;                // why a fallback or a downgrade happened
  usage?: Usage;
}

export interface PageEvidence {
  text?: string;
  screenshot?: string;
}

function evidenceText(e: PageEvidence, maxChars: number): string {
  const text = (e.text ?? "").trim().slice(0, maxChars);
  return text ? `PAGE TEXT EXCERPT\n${text}` : "No page text was available. Judge from the screenshot.";
}

async function viaDecisions(e: PageEvidence, maxChars: number): Promise<{ choice: string; confidence: number }> {
  const choices = getConfig().page_check.choices.map(({ value, description }) => ({ value, description }));
  return decideChoice({
    name: "page_kind",
    instructions: loadPrompt(BLOCK_ID),
    choices,
    text: evidenceText(e, maxChars),
    imageBase64: e.text?.trim() ? undefined : e.screenshot,
  });
}

async function viaGemini(e: PageEvidence, maxChars: number): Promise<{ choice: string; confidence: number; usage: Usage }> {
  const choices = getConfig().page_check.choices;
  const parts: InputPart[] = [];
  if (!e.text?.trim() && e.screenshot) parts.push({ image: e.screenshot });
  parts.push({ text: `${evidenceText(e, maxChars)}\n\nANSWERS\n${choices.map((c) => `${c.value}: ${c.description}`).join("\n")}` });
  const { data, usage } = await callBlock<{ answer: string; confidence: number }>({
    blockId: BLOCK_ID,
    parts,
    schema: {
      type: "object",
      properties: { answer: { type: "string", enum: choices.map((c) => c.value) }, confidence: { type: "number", minimum: 0, maximum: 1 } },
      required: ["answer", "confidence"],
    },
  });
  return { choice: data.answer, confidence: data.confidence, usage };
}

/** Map a raw answer to a gate result. Unknown answers and low confidence close the gate. */
export function toGate(choice: string, confidence: number, provider: PageGate["provider"], note?: string): PageGate {
  const cfg = getConfig().page_check;
  const match = cfg.choices.find((c) => c.value === choice);
  const closed = !match || match.setting === "none" || confidence < cfg.min_confidence;
  const reason = !match ? `unknown answer '${choice}'` : confidence < cfg.min_confidence && match.setting !== "none" ? `low confidence ${confidence.toFixed(2)}` : undefined;
  return {
    status: closed ? "not_clinical" : "clinical",
    kind: match?.value ?? choice,
    setting: closed ? "none" : (match?.setting ?? "none"),
    confidence,
    provider,
    note: [note, reason].filter(Boolean).join("; ") || undefined,
  };
}

/**
 * The privacy gate. Runs before anything on the page is read. Decisions API first (fast,
 * bounded), Gemini as the fallback. Any failure on every provider closes the gate.
 */
export async function checkPage(e: PageEvidence): Promise<PageGate> {
  const cfg = getConfig().page_check;
  if (!e.text?.trim() && !e.screenshot) return toGate("not_clinical", 1, "gemini", "no page content");

  if (cfg.provider === "openai_decisions") {
    try {
      const r = await viaDecisions(e, cfg.max_chars);
      return toGate(r.choice, r.confidence, "openai_decisions");
    } catch (err) {
      if (cfg.fallback === "none") return toGate("not_clinical", 1, "openai_decisions", `Decisions API failed: ${String(err)}`);
      try {
        const r = await viaGemini(e, cfg.max_chars);
        return { ...toGate(r.choice, r.confidence, "gemini", `Decisions API failed: ${String(err)}`), usage: r.usage };
      } catch (err2) {
        return toGate("not_clinical", 1, "gemini", `both providers failed: ${String(err2)}`);
      }
    }
  }
  try {
    const r = await viaGemini(e, cfg.max_chars);
    return { ...toGate(r.choice, r.confidence, "gemini"), usage: r.usage };
  } catch (err) {
    return toGate("not_clinical", 1, "gemini", `page check failed: ${String(err)}`);
  }
}
