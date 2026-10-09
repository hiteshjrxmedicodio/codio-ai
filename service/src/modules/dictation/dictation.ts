import { z } from "zod";
import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import { decideChoice, transcribe } from "../../core/llm/openai";
import { loadPrompt } from "../../core/prompts";
import type { Usage } from "../../core/types";

export const REPORT_BLOCK = "P-DICT-REPORT";
export const PICK_BLOCK = "D-PICK-SECTION";
const NONE = "none";

export interface ReportSection {
  name: string;
  /** The section's display name, from its config name. */
  title: string;
  text: string;
}

export interface DictatedReport {
  transcript: string;
  sections: ReportSection[];
  usage?: Usage;
}

const titleOf = (name: string) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Speech in, report sections out. Whisper transcribes; one Gemini block files what was said. */
export async function dictateReport(audioBase64: string, mimeType: string): Promise<DictatedReport> {
  const cfg = getConfig();
  const mb = (audioBase64.length * 3) / 4 / 1024 / 1024;
  if (mb > cfg.dictation.max_audio_mb) throw new Error(`Recording is ${mb.toFixed(1)} MB; the limit is ${cfg.dictation.max_audio_mb} MB`);
  const transcript = await transcribe(audioBase64, mimeType, cfg.dictation.whisper_prompt);
  if (!transcript) return { transcript, sections: [] };
  return { transcript, ...(await structureTranscript(transcript)) };
}

/**
 * Live transcription: one piece of an ongoing dictation. The end of what was already written goes
 * with it as Whisper context, so a word or sentence cut at the boundary still comes out right.
 */
export async function transcribePiece(audioBase64: string, mimeType: string, previous: string): Promise<{ text: string }> {
  const cfg = getConfig().dictation;
  const context = previous.slice(-cfg.context_chars);
  const text = await transcribe(audioBase64, mimeType, [cfg.whisper_prompt, context].filter(Boolean).join(" "));
  return { text };
}

export async function structureTranscript(transcript: string): Promise<{ sections: ReportSection[]; usage: Usage }> {
  const sections = getConfig().sections;
  const names = sections.map((s) => s.name);
  const { data, usage } = await callBlock<{ sections: Array<{ name: string; text: string }> }>({
    blockId: REPORT_BLOCK,
    parts: [{ text: `TRANSCRIPT\n${transcript}\n\nREPORT SECTIONS\n${sections.map((s) => `${s.name}: ${s.description}`).join("\n")}` }],
    schema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string", enum: names }, text: { type: "string" } }, required: ["name", "text"] },
        },
      },
      required: ["sections"],
    },
  });
  // One entry per section, in the configured order; repeated names are joined.
  const byName = new Map<string, string>();
  for (const s of data.sections) {
    const text = s.text.trim();
    if (text && names.includes(s.name)) byName.set(s.name, [byName.get(s.name), text].filter(Boolean).join("\n"));
  }
  return { sections: names.filter((n) => byName.has(n)).map((n) => ({ name: n, title: titleOf(n), text: byName.get(n) as string })), usage };
}

export const MatchBodySchema = z.object({
  label: z.string().default(""),
  nearby: z.string().default(""),
  title: z.string().default(""),
  sections: z.array(z.string()).min(1),
});
export type MatchBody = z.infer<typeof MatchBodySchema>;

const words = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/**
 * Which report section belongs in the field the provider clicked. A label that names a section
 * (its own name or a configured alias) is matched directly; anything else goes to the Decisions
 * API, and a weak or failed answer leaves the field empty.
 */
export async function matchField(body: MatchBody): Promise<{ section: string | null; confidence: number; how: string }> {
  const cfg = getConfig();
  const label = words(body.label);
  if (label) {
    for (const name of body.sections) {
      const names = [words(name), ...(cfg.dictation.field_aliases[name] ?? []).map(words)];
      if (names.includes(label)) return { section: name, confidence: 1, how: "label" };
    }
  }
  if (!label && !words(body.nearby)) return { section: null, confidence: 0, how: "no label" };
  const described = cfg.sections.filter((s) => body.sections.includes(s.name));
  try {
    const r = await decideChoice({
      name: "section",
      instructions: loadPrompt(PICK_BLOCK),
      choices: [...described.map((s) => ({ value: s.name, description: s.description })), { value: NONE, description: "No listed section belongs in this field" }],
      text: `FIELD LABEL: ${body.label || "(none)"}\nNEARBY TEXT: ${body.nearby.slice(0, 600) || "(none)"}\nPAGE TITLE: ${body.title}`,
    });
    const ok = r.choice !== NONE && body.sections.includes(r.choice) && r.confidence >= cfg.dictation.min_confidence;
    return { section: ok ? r.choice : null, confidence: r.confidence, how: "decisions" };
  } catch (err) {
    return { section: null, confidence: 0, how: `decisions failed: ${String(err)}` };
  }
}
