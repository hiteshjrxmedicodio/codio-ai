import type { Finding, Section } from "../../../core/types";

/** Whitespace, case and typographic quotes/dashes are ignored; every word must match. */
export function normaliseForMatch(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface QuoteCheckResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/**
 * A finding survives only if every quote appears in the note word for word.
 * A quote found in a different section than claimed is kept and its section corrected.
 */
export function checkQuotes(findings: Finding[], sections: Section[]): QuoteCheckResult {
  const bySection = new Map(sections.map((s) => [s.name, normaliseForMatch(s.text)]));
  const kept: Finding[] = [];
  const dropped: QuoteCheckResult["dropped"] = [];

  for (const finding of findings) {
    if (!finding.quotes.length) {
      dropped.push({ finding, reason: "no quote" });
      continue;
    }
    let ok = true;
    const quotes = finding.quotes.map((q) => {
      const needle = normaliseForMatch(q.text);
      if (needle && bySection.get(q.section)?.includes(needle)) return q;
      const actual = needle ? [...bySection].find(([, text]) => text.includes(needle))?.[0] : undefined;
      if (!actual) ok = false;
      return actual ? { ...q, section: actual } : q;
    });
    if (ok) kept.push({ ...finding, quotes });
    else dropped.push({ finding, reason: "quote not found in note" });
  }
  return { kept, dropped };
}
