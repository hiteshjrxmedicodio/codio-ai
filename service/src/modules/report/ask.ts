import { z } from "zod";
import { getBlockConfig, getConfig } from "../../core/config";
import { getClient, thinkingConfig } from "../../core/llm/gemini";
import { loadPrompt } from "../../core/prompts";
import { collectIdentifiers, redactText } from "../../core/privacy/redact";

export const BLOCK_ID = "P-REPORT-ASK";

export const AskBodySchema = z.object({
  title: z.string().default(""),
  report: z.string().min(1),
  question: z.string().min(1),
  earlier: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
});

export type AskBody = z.infer<typeof AskBodySchema>;

/** One question about one report, answered from the report's own text only. */
export async function askAboutReport(body: AskBody): Promise<{ answer: string }> {
  const block = getBlockConfig(BLOCK_ID);
  const earlier = body.earlier.map((e) => `PROVIDER: ${e.q}\nYOU: ${e.a}`).join("\n\n");
  const known = collectIdentifiers(body.report);
  const text = [
    `REPORT TITLE: ${body.title || "(unknown)"}`,
    `REPORT\n${body.report.slice(0, getConfig().report.max_chars)}`,
    earlier ? `EARLIER IN THIS CONVERSATION\n${earlier}` : "",
    `QUESTION: ${body.question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await getClient().models.generateContent({
    model: block.model,
    contents: [{ role: "user", parts: [{ text: redactText(text, known) }] }],
    config: {
      systemInstruction: loadPrompt(BLOCK_ID),
      temperature: block.temperature,
      maxOutputTokens: block.max_output_tokens,
      thinkingConfig: thinkingConfig(block.thinking),
      httpOptions: { timeout: getConfig().llm.timeout_ms },
    },
  });
  return { answer: redactText((res.text ?? "").trim(), known) || "I couldn't find an answer in this report." };
}
