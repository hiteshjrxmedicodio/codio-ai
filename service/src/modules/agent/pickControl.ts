import { z } from "zod";
import { getConfig } from "../../core/config";
import { decideChoice } from "../../core/llm/openai";
import { loadPrompt } from "../../core/prompts";

export const BLOCK_ID = "D-PICK-CONTROL";
const NONE = "none";

export const ControlSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.string(),
  where: z.string(),
});

export type Control = z.infer<typeof ControlSchema>;

export interface PickResult {
  id: string | null;
  confidence: number;
  reason: string;
}

/**
 * Choose which visible control to use, grounded in the page's own controls instead of pixel
 * guesses. The extension has already removed controls whose labels look record-changing, so
 * an unsafe control can never be chosen here.
 */
export async function pickControl(goal: string, title: string, controls: Control[]): Promise<PickResult> {
  const cfg = getConfig().decisions.pick_control;
  if (!cfg.enabled) return { id: null, confidence: 0, reason: "Control picking is turned off; click by position instead." };
  const offered = controls.slice(0, cfg.max_controls);
  if (!offered.length) return { id: null, confidence: 0, reason: "No usable controls are visible." };

  try {
    const r = await decideChoice({
      name: "control",
      instructions: loadPrompt(BLOCK_ID),
      choices: [
        ...offered.map((c) => ({ value: c.id, description: `${c.label || "(no label)"} | ${c.role} | ${c.where}` })),
        { value: NONE, description: "No listed control moves toward the goal" },
      ],
      text: `GOAL: ${goal}\nPAGE TITLE: ${title}`,
    });
    if (r.choice === NONE) return { id: null, confidence: r.confidence, reason: "No visible control matches the goal." };
    if (r.confidence < cfg.min_confidence) return { id: null, confidence: r.confidence, reason: "No confident match among the visible controls." };
    const chosen = offered.find((c) => c.id === r.choice);
    return chosen
      ? { id: chosen.id, confidence: r.confidence, reason: `Chose ${chosen.label} (${chosen.role})` }
      : { id: null, confidence: 0, reason: "The answer did not match a listed control." };
  } catch (err) {
    return { id: null, confidence: 0, reason: `Control picking failed (${String(err)}); click by position instead.` };
  }
}
