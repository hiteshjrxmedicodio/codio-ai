import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import { transcribe } from "../../core/llm/openai";

export const BLOCK_ID = "P-VOICE-CLEAN";

export interface VoiceResult {
  raw: string;
  text: string;
  rephrased: boolean;
}

/** Whisper turns speech into text; a light Gemini model turns that into the message the provider meant. */
export async function transcribeAndClean(audioBase64: string, mimeType: string): Promise<VoiceResult> {
  const cfg = getConfig().voice;
  const mb = (audioBase64.length * 3) / 4 / 1024 / 1024;
  if (mb > cfg.max_audio_mb) throw new Error(`Recording is ${mb.toFixed(1)} MB; the limit is ${cfg.max_audio_mb} MB`);

  const raw = await transcribe(audioBase64, mimeType);
  if (!raw || !cfg.rephrase) return { raw, text: raw, rephrased: false };

  try {
    const { data } = await callBlock<{ message: string }>({
      blockId: BLOCK_ID,
      parts: [{ text: `RAW TRANSCRIPT\n${raw}` }],
      schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    });
    const text = data.message.trim();
    return { raw, text: text || raw, rephrased: Boolean(text) };
  } catch {
    return { raw, text: raw, rephrased: false };
  }
}
