import type { Content, FunctionCall, FunctionDeclaration } from "@google/genai";
import { getBlockConfig, getConfig } from "../config";
import { loadPrompt } from "../prompts";
import type { Usage } from "../types";
import { getClient, thinkingConfig } from "./gemini";
import { redactText } from "../privacy/redact";

export interface ToolTurn {
  /** The model's content exactly as returned. Feed it back unchanged to keep thought signatures. */
  content: Content | undefined;
  calls: FunctionCall[];
  text: string;
  usage: Usage;
}

/** One free-text model call with function calling. The caller owns the loop. */
export async function callWithTools(blockId: string, contents: Content[], tools: FunctionDeclaration[]): Promise<ToolTurn> {
  const block = getBlockConfig(blockId);
  if (!block.enabled) throw new Error(`Block ${blockId} is disabled in config.yaml`);
  const started = Date.now();
  const res = await getClient().models.generateContent({
    model: block.model,
    // Privacy: identifiers are scrubbed from every text part the model is sent.
    contents: contents.map((c) => ({ ...c, parts: (c.parts ?? []).map((p) => (typeof p.text === "string" ? { ...p, text: redactText(p.text) } : p)) })),
    config: {
      systemInstruction: loadPrompt(blockId),
      tools: [{ functionDeclarations: tools }],
      temperature: block.temperature,
      maxOutputTokens: block.max_output_tokens,
      thinkingConfig: thinkingConfig(block.thinking),
      httpOptions: { timeout: getConfig().llm.timeout_ms },
    },
  });
  const meta = res.usageMetadata;
  const content = res.candidates?.[0]?.content;
  const text = (content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  return {
    content,
    calls: res.functionCalls ?? [],
    text,
    usage: {
      block: blockId,
      model: block.model,
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: meta?.candidatesTokenCount ?? 0,
      thinkingTokens: meta?.thoughtsTokenCount ?? 0,
      cachedTokens: meta?.cachedContentTokenCount ?? 0,
      ms: Date.now() - started,
    },
  };
}
