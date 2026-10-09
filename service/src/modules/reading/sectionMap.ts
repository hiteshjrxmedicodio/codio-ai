import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import type { Section, Usage } from "../../core/types";
import type { CapturedBlock } from "./screenRead";

export const BLOCK_ID = "P-READ-MAP";

/** The section-name enum comes from config, so the model can only use configured names. */
export function sectionMapSchema(): Record<string, unknown> {
  const names = getConfig().sections.map((s) => s.name);
  return {
    type: "object",
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string", enum: names }, text: { type: "string" } },
          required: ["name", "text"],
        },
      },
    },
    required: ["sections"],
  };
}

export function sectionMapMessage(blocks: CapturedBlock[]): string {
  const standard = getConfig()
    .sections.map((s) => `${s.name}: ${s.description}`)
    .join("\n");
  const captured = blocks
    .map((b, i) => {
      const flags = [b.cut_top && "cut off at top", b.cut_bottom && "cut off at bottom", b.has_unreadable && "has unreadable parts"].filter(Boolean);
      return `--- BLOCK ${i + 1} | heading: ${b.heading || "(none)"}${flags.length ? ` | ${flags.join(", ")}` : ""}\n${b.text}`;
    })
    .join("\n\n");
  return `STANDARD SECTIONS\n${standard}\n\nCAPTURED BLOCKS\n${captured}`;
}

export async function runSectionMap(blocks: CapturedBlock[]): Promise<{ sections: Section[]; usage: Usage }> {
  const { data, usage } = await callBlock<{ sections: Section[] }>({
    blockId: BLOCK_ID,
    parts: [{ text: sectionMapMessage(blocks) }],
    schema: sectionMapSchema(),
  });
  return { sections: data.sections, usage };
}
