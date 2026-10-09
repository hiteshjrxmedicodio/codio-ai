import { getConfig } from "../../../core/config";
import { callBlock } from "../../../core/llm/gemini";
import { decideChoice } from "../../../core/llm/openai";
import { loadPrompt } from "../../../core/prompts";
import type { CareSetting, Finding, GateAnswer, GateResult, Quote, Section, Usage } from "../../../core/types";
import { CONFIDENCE_SCHEMA, noteText } from "../note";

export const BLOCK_ID = "P-GATE";

export const GATE_ANSWERS: GateAnswer[] = ["not_real", "not_critical", "coding", "denial", "interpretation"];

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", enum: GATE_ANSWERS, description: "not_real | not_critical (real but not critical) | coding | denial | interpretation" },
    reason: { type: "string" },
    confidence: CONFIDENCE_SCHEMA,
  },
  required: ["answer", "reason", "confidence"],
};

/** The gate reads only the sections its finding quotes, not the whole note. */
export function quotedSections(finding: Finding, sections: Section[]): Section[] {
  const names = new Set(finding.quotes.map((q) => q.section));
  return sections.filter((s) => names.has(s.name));
}

/**
 * A clinical-validation finding carries its evidence on both sides; the gate and the fix see which
 * quote is which, so the fix can present both with equal weight instead of leading the provider.
 */
function validationSides(finding: Finding): string {
  if (finding.kind !== "validation") return "";
  const d = finding.detail as { gap?: string; missingElement?: string; supporting?: Quote[]; against?: Quote[] };
  const list = (qs: Quote[] | undefined) => (qs?.length ? qs.map((q) => `(section ${q.section}): ${q.text}`).join("\n") : "none in the note");
  return [`GAP: ${d.gap ?? "unknown"}`, `MISSING ELEMENT: ${d.missingElement ?? ""}`, `EVIDENCE FOR\n${list(d.supporting)}`, `EVIDENCE AGAINST\n${list(d.against)}`].join("\n");
}

export function findingMessage(finding: Finding, sections: Section[], setting: CareSetting): string {
  const quotes = finding.quotes.map((q, i) => `QUOTE ${i + 1} (section ${q.section}): ${q.text}`).join("\n");
  return [
    `FINDING KIND: ${finding.kind}`,
    `FINDING: ${finding.title}`,
    quotes,
    validationSides(finding),
    `CARE SETTING: ${setting}`,
    `SECTIONS THE QUOTES COME FROM\n${noteText(quotedSections(finding, sections))}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function viaGemini(message: string): Promise<{ gate: GateResult; usage: Usage }> {
  const { data, usage } = await callBlock<Omit<GateResult, "source">>({ blockId: BLOCK_ID, parts: [{ text: message }], schema: SCHEMA });
  return { gate: { ...data, source: "P-GATE" }, usage };
}

/**
 * Decide whether one finding is critical. A five-way choice, so the Decisions API answers it
 * by default (input tokens only, no thinking); Gemini answers when Decisions errors or refuses.
 */
export async function runGate(finding: Finding, sections: Section[], setting: CareSetting): Promise<{ gate: GateResult; usage?: Usage }> {
  const cfg = getConfig().decisions.gate;
  const message = findingMessage(finding, sections, setting);
  if (cfg.provider !== "openai_decisions") return viaGemini(message);
  try {
    const r = await decideChoice({ name: "criticality", instructions: loadPrompt(BLOCK_ID), choices: cfg.choices, text: message });
    const label = cfg.choices.find((c) => c.value === r.choice)?.description ?? r.choice;
    return { gate: { answer: r.choice as GateAnswer, reason: label, confidence: r.confidence, source: "decisions" } };
  } catch {
    return viaGemini(message);
  }
}
