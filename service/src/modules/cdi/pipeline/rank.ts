import type { Finding, GateAnswer, Suggestion } from "../../../core/types";
import { normaliseForMatch } from "./quoteCheck";

/** Findings from different finders that quote the same text are one finding. */
export function mergeDuplicates(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = f.quotes.map((q) => normaliseForMatch(q.text)).sort().join("||");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, f);
      continue;
    }
    const [keep, other] = existing.confidence >= f.confidence ? [existing, f] : [f, existing];
    byKey.set(key, { ...keep, alsoFoundBy: [...new Set([...(keep.alsoFoundBy ?? []), other.block])] });
  }
  return [...byKey.values()];
}

export interface RankOptions {
  shownAnswers: GateAnswer[];   // in rank order
  maxSuggestions: number;
  minConfidence: number;
}

/** Split gated findings into what the provider sees (ranked, capped) and what stays hidden. */
export function rankAndCap(items: Suggestion[], opts: RankOptions): { shown: Suggestion[]; hidden: Suggestion[] } {
  const order = new Map(opts.shownAnswers.map((a, i) => [a, i]));
  const eligible = items.filter((s) => order.has(s.gate.answer) && s.confidence >= opts.minConfidence);
  eligible.sort(
    (a, b) =>
      (order.get(a.gate.answer) ?? 99) - (order.get(b.gate.answer) ?? 99) ||
      b.gate.confidence * b.confidence - a.gate.confidence * a.confidence,
  );
  const shown = eligible.slice(0, opts.maxSuggestions);
  const shownIds = new Set(shown.map((s) => s.id));
  return { shown, hidden: items.filter((s) => !shownIds.has(s.id)) };
}
