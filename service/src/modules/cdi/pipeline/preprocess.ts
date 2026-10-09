import type { Finding, Section, Usage } from "../../../core/types";
import { normalizeReport, type CdiChange } from "../normalize/normalize";
import { normaliseForMatch } from "./quoteCheck";

/**
 * Preprocessing for the documentation review: the same P-CDI-NORMALIZE step the coding run uses, so
 * spelling, grammar and abbreviations are corrected before any finder reads the note and no finder
 * ever reports one. A failure passes the note on unchanged; it never sinks the review.
 */
export async function preprocessSections(
  sections: Section[],
): Promise<{ sections: Section[]; changes: CdiChange[]; usage?: Usage; error?: string }> {
  try {
    const r = await normalizeReport(sections.map((s) => ({ heading: s.name, text: s.text })));
    return { sections: sections.map((s, i) => ({ name: s.name, text: r.blocks[i]?.text ?? s.text })), changes: r.changes, usage: r.usage };
  } catch (err) {
    return { sections, changes: [], error: String(err) };
  }
}

/** The quote with each preprocessing change undone, longest first, so a corrected word goes back to how the page wrote it. */
function undo(text: string, changes: CdiChange[]): string {
  return [...changes]
    .sort((a, b) => b.after.length - a.after.length)
    .reduce((t, c) => (c.after && t.includes(c.after) ? t.split(c.after).join(c.before) : t), text);
}

/**
 * Finders quote the corrected note, but highlights and the provider read the page as written. Each
 * quote is put back into the page's own wording: first with its section's changes undone, then with
 * every section's. A quote that cannot be put back is left as the finder wrote it.
 */
export function restoreQuotes(findings: Finding[], original: Section[], changes: CdiChange[]): Finding[] {
  if (!changes.length) return findings;
  const texts = original.map((s) => normaliseForMatch(s.text));
  const onPage = (t: string) => texts.some((x) => x.includes(normaliseForMatch(t)));
  return findings.map((f) => ({
    ...f,
    quotes: f.quotes.map((q) => {
      if (onPage(q.text)) return q;
      const idx = original.findIndex((s) => s.name === q.section);
      const own = undo(q.text, changes.filter((c) => c.index === idx));
      if (onPage(own)) return { ...q, text: own };
      const any = undo(q.text, changes);
      return onPage(any) ? { ...q, text: any } : q;
    }),
  }));
}
