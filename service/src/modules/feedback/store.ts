import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SERVICE_ROOT } from "../../core/config";

const FEEDBACK_FILE = join(SERVICE_ROOT, "data", "feedback.jsonl");

export const FeedbackSchema = z.object({
  suggestionId: z.string(),
  vote: z.enum(["up", "down"]),
  block: z.string(),
  kind: z.string(),
  gateAnswer: z.string(),
  title: z.string(),
  quotes: z.array(z.object({ section: z.string(), text: z.string() })),
  setting: z.string(),
  promptVersion: z.string().optional(),
  provider: z.string().optional(),
  facility: z.string().optional(),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

/**
 * Local JSONL log. A thumbs down records the finding only; the provider is never asked why.
 * The weekly specialist review reads this file. Holds quotes, so it is PHI: keep it local.
 */
export async function recordFeedback(entry: Feedback): Promise<void> {
  await mkdir(join(SERVICE_ROOT, "data"), { recursive: true });
  await appendFile(FEEDBACK_FILE, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, "utf8");
}

export async function readFeedback(): Promise<(Feedback & { at: string })[]> {
  try {
    const raw = await readFile(FEEDBACK_FILE, "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
