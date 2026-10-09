import type { CapturedBlock } from "./types";

/** An identifier shown on the chart, such as a Med ID or an MRN. */
export interface ChartId {
  label: string;
  value: string;
}

const MAX_IDS = 3;
const MAX_VALUE_CHARS = 40;

const norm = (s: string) => s.replace(/^[#\s]+/, "").replace(/[:#\s]+$/, "").replace(/\s+/g, " ").trim();

/** A value worth showing: not masked, not a sentence, and holds a digit, as identifiers do (a bare word is the next label). */
function usable(value: string): boolean {
  return Boolean(value) && value.length <= MAX_VALUE_CHARS && !/\*/.test(value) && value.split(" ").length <= 3 && /\d/.test(value);
}

/**
 * The value right after a label. Headers often run several fields together on one line, so the
 * value ends at the first separator or wide gap, and a value that still runs on keeps its first word.
 */
function firstValue(rest: string): string {
  const head = norm(rest.split(/\s[·|•,;]\s|\s{2,}|\t/)[0] ?? "");
  return head.split(" ").length > 3 ? (head.split(" ")[0] ?? "") : head;
}

/**
 * Find the chart's identifiers on the page, by the labels in `labels`. The value is the rest of
 * the label's line, or the next line when the label stands alone. Masked values are skipped, so
 * a redacted patient ID never becomes a title.
 */
export function findChartIds(blocks: CapturedBlock[], labels: string[]): ChartId[] {
  const wanted = new Map(labels.map((l) => [l.toLowerCase(), l]));
  const lines = blocks.flatMap((b) => [b.heading, ...b.text.split("\n")]).map((l) => l.trim()).filter(Boolean);
  const found: ChartId[] = [];
  for (let i = 0; i < lines.length && found.length < MAX_IDS; i++) {
    const line = lines[i] as string;
    for (const [key, label] of wanted) {
      const m = new RegExp(`^[#\\s]*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[\\s:#]*(.*)$`, "i").exec(line);
      if (!m) continue;
      const value = firstValue(m[1] || lines[i + 1] || "");
      if (usable(value) && !found.some((f) => f.label === label)) found.push({ label, value });
      break;
    }
  }
  return found;
}
