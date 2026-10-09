import { getConfig } from "../config";
import { redactText } from "../privacy/redact";

function settings() {
  const cfg = getConfig().openai;
  const apiKey = process.env[cfg.api_key_env];
  if (!apiKey) throw new Error(`${cfg.api_key_env} is not set. Put it in service/.env`);
  return { ...cfg, apiKey };
}

async function post(path: string, body: BodyInit, headers: Record<string, string> = {}): Promise<unknown> {
  const s = settings();
  const res = await fetch(`${s.base_url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.apiKey}`, ...headers },
    body,
    signal: AbortSignal.timeout(s.timeout_ms),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(`OpenAI ${path} returned ${res.status}: ${message}`);
  }
  return data;
}

export interface ChoiceSpec {
  value: string;
  description: string;
}

export type Question =
  | { type: "choice"; name: string; instructions: string; choices: ChoiceSpec[] }
  | { type: "predicate"; name: string; instructions: string };

export interface Answer {
  name: string;
  refused: boolean;
  choice?: string;
  probability?: number;
  confidence?: number;
}

/**
 * Several bounded questions over one shared input, in one request to the OpenAI Decisions API
 * (POST /v1/decisions). Billed on input tokens only. A refusal is returned per question, never
 * turned into a false or a zero; callers decide what a refusal means.
 */
export async function decide(args: { text: string; imageBase64?: string; questions: Question[] }): Promise<Map<string, Answer>> {
  // Privacy: identifiers are scrubbed before the text is sent.
  const content: Record<string, string>[] = [{ type: "input_text", text: redactText(args.text) }];
  if (args.imageBase64) content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${args.imageBase64}` });
  const data = (await post(
    "/decisions",
    JSON.stringify({ model: settings().decisions_model, input: [{ role: "user", content }], questions: args.questions }),
    { "content-type": "application/json" },
  )) as { answers?: { type: string; name: string; choice?: string; probability?: number; confidence?: number }[] };

  const out = new Map<string, Answer>();
  for (const q of args.questions) {
    const a = data.answers?.find((x) => x.name === q.name);
    out.set(q.name, {
      name: q.name,
      refused: !a || a.type === "refusal",
      choice: a?.choice,
      probability: a?.probability,
      confidence: a?.confidence,
    });
  }
  return out;
}

/** One choice question. A refusal or missing answer is thrown so the caller can fall back. */
export async function decideChoice(args: {
  name: string;
  instructions: string;
  choices: ChoiceSpec[];
  text: string;
  imageBase64?: string;
}): Promise<{ choice: string; confidence: number }> {
  const answers = await decide({
    text: args.text,
    imageBase64: args.imageBase64,
    questions: [{ type: "choice", name: args.name, instructions: args.instructions, choices: args.choices }],
  });
  const a = answers.get(args.name);
  if (!a || a.refused || !a.choice) throw new Error("Decisions API refused or returned no answer");
  return { choice: a.choice, confidence: a.confidence ?? 0 };
}

/** Whisper speech-to-text (POST /v1/audio/transcriptions). */
/** `prompt` tells Whisper what kind of speech to expect, which steadies clinical vocabulary. */
export async function transcribe(audioBase64: string, mimeType: string, prompt?: string): Promise<string> {
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("model", settings().transcribe_model);
  if (prompt) form.append("prompt", prompt);
  form.append("file", new Blob([Buffer.from(audioBase64, "base64")], { type: mimeType }), `speech.${ext}`);
  const data = (await post("/audio/transcriptions", form)) as { text?: string };
  return (data.text ?? "").trim();
}
