import { getConfig } from "../../../core/config";
import { decide } from "../../../core/llm/openai";
import { loadPrompt } from "../../../core/prompts";
import type { CareSetting, Section } from "../../../core/types";
import { noteMessage } from "../note";

export interface PrescreenResult {
  /** Finder block ids that should run. */
  run: string[];
  /** Finder block ids skipped, with the probability that justified it. */
  skipped: { finder: string; probability: number }[];
  note?: string;
}

/**
 * One Decisions API request, one probability question per finder, all over the same note.
 * A finder is skipped only when its probability is below skip_below. A refusal, a missing
 * answer or any error runs the finder: skipping is the only way this can cost recall.
 */
export async function prescreenFinders(finders: string[], sections: Section[], setting: CareSetting): Promise<PrescreenResult> {
  const cfg = getConfig().decisions.prescreen;
  const screened = finders.filter((f) => cfg.finders[f]);
  if (!cfg.enabled || !screened.length) return { run: finders, skipped: [] };

  try {
    const answers = await decide({
      text: noteMessage(sections, setting),
      questions: screened.map((f) => ({ type: "predicate" as const, name: f.replace(/[^a-zA-Z0-9_]/g, "_"), instructions: loadPrompt(cfg.finders[f] as string) })),
    });
    const skipped: PrescreenResult["skipped"] = [];
    const run = finders.filter((f) => {
      const a = answers.get(f.replace(/[^a-zA-Z0-9_]/g, "_"));
      if (!a || a.refused || a.probability === undefined) return true;
      if (a.probability < cfg.skip_below) {
        skipped.push({ finder: f, probability: a.probability });
        return false;
      }
      return true;
    });
    return { run, skipped };
  } catch (err) {
    return { run: finders, skipped: [], note: `Pre-screen unavailable, every finder ran: ${String(err)}` };
  }
}
