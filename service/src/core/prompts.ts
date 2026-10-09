import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_ROOT, getPromptPath } from "./config";

/** Prompt files are read once per process. Edit the .txt file and restart to pick up changes. */
const cache = new Map<string, string>();

export const PROMPT_DIR = join(SERVICE_ROOT, "prompts");

/** The prompt text for a Gemini block (system instruction) or a Decisions block (question instructions). */
export function loadPrompt(blockId: string): string {
  const hit = cache.get(blockId);
  if (hit) return hit;
  const text = readFileSync(join(PROMPT_DIR, getPromptPath(blockId)), "utf8").trim();
  cache.set(blockId, text);
  return text;
}
