import { randomUUID } from "node:crypto";
import type { CareSetting, Section } from "../../core/types";

/**
 * The note always comes first in the user message, identically for every finder, so the
 * shared prefix can be served from Gemini's implicit cache on calls 2..n.
 */
export function noteText(sections: Section[]): string {
  return sections
    .filter((s) => s.text.trim())
    .map((s) => `=== SECTION: ${s.name} ===\n${s.text.trim()}`)
    .join("\n\n");
}

export function noteMessage(sections: Section[], setting: CareSetting): string {
  return `NOTE\n${noteText(sections)}\n\nCARE SETTING: ${setting}`;
}

export function findingId(): string {
  return randomUUID().slice(0, 8);
}

/** Reusable JSON-schema fragments. Gemini rejects additionalProperties, so none is used. */
export const QUOTE_SCHEMA = {
  type: "object",
  properties: {
    section: { type: "string", description: "Section name exactly as labelled in the note" },
    text: { type: "string", description: "Exact text copied from the note" },
  },
  required: ["section", "text"],
} as const;

export const CONFIDENCE_SCHEMA = { type: "number", minimum: 0, maximum: 1 } as const;
