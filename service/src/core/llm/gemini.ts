import { GoogleGenAI, ThinkingLevel, type Part, type ThinkingConfig } from "@google/genai";
import { getBlockConfig, getConfig } from "../config";
import { loadPrompt } from "../prompts";
import type { Usage } from "../types";
import { redactText } from "../privacy/redact";
import { stopSignal, throwIfStopped } from "../stop";

/** One user-message part: text, or an image as base64 JPEG/PNG. */
export type InputPart = { text: string } | { image: string; mimeType?: string };

export interface BlockCall {
  blockId: string;
  parts: InputPart[];
  schema: Record<string, unknown>;
}

export interface BlockReply<T> {
  data: T;
  usage: Usage;
}

let client: GoogleGenAI | undefined;

export function getClient(): GoogleGenAI {
  if (client) return client;
  const envName = getConfig().llm.api_key_env;
  const apiKey = process.env[envName];
  if (!apiKey) throw new Error(`${envName} is not set. Put it in service/.env`);
  client = new GoogleGenAI({ apiKey });
  return client;
}

const LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export function thinkingConfig(value: string | number): ThinkingConfig {
  return typeof value === "number" ? { thinkingBudget: value } : { thinkingLevel: LEVELS[value] };
}

export function toParts(parts: InputPart[]): Part[] {
  return parts.map((p) =>
    "text" in p ? { text: p.text } : { inlineData: { mimeType: p.mimeType ?? "image/jpeg", data: p.image } },
  );
}

/**
 * The single entry point for every model call. The prompt file is the system instruction;
 * the response shape is enforced by the JSON schema, never described in the prompt.
 */
export async function callBlock<T>(call: BlockCall): Promise<BlockReply<T>> {
  const block = getBlockConfig(call.blockId);
  if (!block.enabled) throw new Error(`Block ${call.blockId} is disabled in config.yaml`);
  const { timeout_ms, parse_retries } = getConfig().llm;
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= parse_retries; attempt++) {
    throwIfStopped();
    const res = await getClient().models.generateContent({
      model: block.model,
      // Privacy: identifiers are scrubbed from every text part before it leaves this machine.
      contents: [{ role: "user", parts: toParts(call.parts.map((p) => ("text" in p ? { text: redactText(p.text) } : p))) }],
      config: {
        systemInstruction: loadPrompt(call.blockId),
        responseMimeType: "application/json",
        responseJsonSchema: call.schema,
        temperature: block.temperature,
        maxOutputTokens: block.max_output_tokens,
        thinkingConfig: thinkingConfig(block.thinking),
        httpOptions: { timeout: timeout_ms },
        abortSignal: stopSignal(),
      },
    });
    try {
      const data = JSON.parse(res.text ?? "") as T;
      const meta = res.usageMetadata;
      return {
        data,
        usage: {
          block: call.blockId,
          model: block.model,
          inputTokens: meta?.promptTokenCount ?? 0,
          outputTokens: meta?.candidatesTokenCount ?? 0,
          thinkingTokens: meta?.thoughtsTokenCount ?? 0,
          cachedTokens: meta?.cachedContentTokenCount ?? 0,
          ms: Date.now() - started,
        },
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${call.blockId} returned unparseable JSON: ${String(lastError)}`);
}
