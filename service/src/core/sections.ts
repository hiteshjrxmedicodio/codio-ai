/**
 * Report sections that are history, not this encounter: past medical and surgical history, family
 * and social history. Nothing in them is coded or reviewed. A past condition the provider carries
 * into the note's own sections (an old infarction named in the assessment) is still coded, as
 * history; a condition that appears only under a history heading is not. The headings are
 * configured (history_sections in config.yaml) and matched on the heading alone, never the text.
 */
import { getConfig } from "./config";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** True when this heading names a history section. */
export function isHistorySection(heading: string): boolean {
  const cfg = getConfig().history_sections;
  if (!cfg.enabled) return false;
  const h = norm(heading);
  if (!h) return false;
  return cfg.headings.some((name) => {
    const n = norm(name);
    // A bare "history" is a history section only as the whole heading: "History of Present Illness" is the encounter.
    if (n === "history") return h === n;
    return h === n || h.startsWith(`${n} `) || h.endsWith(` ${n}`) || h.includes(` ${n} `);
  });
}

/** The sections of a report that are not history, in order. */
export const withoutHistory = <T extends { heading?: string; name?: string }>(sections: T[]): T[] =>
  sections.filter((s) => !isHistorySection(s.heading ?? s.name ?? ""));
