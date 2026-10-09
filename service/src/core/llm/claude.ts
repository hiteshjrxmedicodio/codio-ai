import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config";
import { loadPrompt } from "../prompts";
import { redactText } from "../privacy/redact";
import { stopSignal, throwIfStopped } from "../stop";
import type { Usage } from "../types";
import type { BlockCall, BlockReply } from "./gemini";

let client: Anthropic | undefined;

function getClaude(): Anthropic {
  if (client) return client;
  const cfg = getConfig().anthropic;
  const apiKey = process.env[cfg.api_key_env];
  if (!apiKey) throw new Error(`${cfg.api_key_env} is not set. Put it in service/.env`);
  client = new Anthropic({ apiKey, timeout: cfg.timeout_ms });
  return client;
}

/** A block's thinking level as Claude's effort; Claude has no `minimal`, and no token budgets on current models. */
const EFFORT = { minimal: "low", low: "low", medium: "medium", high: "high" } as const;

const UNSUPPORTED = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"]);

/**
 * The block's JSON schema in the form Claude's structured outputs accept: every object closed with
 * `additionalProperties: false`, and numeric, length and array-size constraints dropped (they are
 * not supported; the prompts already say what the values mean).
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (!UNSUPPORTED.has(k)) out[k] = strictSchema(v);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/**
 * One block on Claude: the prompt file as the system prompt, the block's schema as structured
 * output, effort from the block's thinking level. Sampling settings are not sent (current Claude
 * models reject non-default temperature). Identifiers are scrubbed from every text part first.
 */
export async function callClaude<T>(call: BlockCall, block: { model: string; thinking: string | number; max_output_tokens: number }): Promise<BlockReply<T>> {
  if (typeof block.thinking === "number") throw new Error(`${call.blockId}: Claude takes a thinking level (low|medium|high), not a token budget`);
  const cfg = getConfig().anthropic;
  const content: Anthropic.Beta.BetaContentBlockParam[] = call.parts.map((p) =>
    "text" in p
      ? { type: "text", text: redactText(p.text) }
      : { type: "image", source: { type: "base64", media_type: (p.mimeType ?? "image/jpeg") as "image/jpeg", data: p.image } },
  );
  throwIfStopped();
  const started = Date.now();
  const msg = await getClaude()
    .beta.messages.stream({
      model: block.model,
      max_tokens: block.max_output_tokens,
      system: loadPrompt(call.blockId),
      messages: [{ role: "user", content }],
      output_config: {
        effort: EFFORT[block.thinking as keyof typeof EFFORT] ?? "medium",
        format: { type: "json_schema", schema: strictSchema(call.schema) as Record<string, unknown> },
      },
      // On a safety decline, the API re-runs the request on Anthropic's recommended fallback model.
      ...(cfg.refusal_fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    }, { signal: stopSignal() }) // Stop cancels the request in flight
    .finalMessage();

  if (msg.stop_reason === "refusal") throw new Error(`${call.blockId} was declined by Claude (${msg.stop_details?.category ?? "no category"})`);
  if (msg.stop_reason === "max_tokens") throw new Error(`${call.blockId} ran out of output tokens (${block.max_output_tokens}); raise max_output_tokens in config.yaml`);
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const usage: Usage = {
    block: call.blockId,
    model: msg.model,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    thinkingTokens: 0, // counted inside output tokens on Claude
    cachedTokens: msg.usage.cache_read_input_tokens ?? 0,
    ms: Date.now() - started,
  };
  return { data: JSON.parse(text) as T, usage };
}
