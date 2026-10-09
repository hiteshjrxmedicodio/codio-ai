import type { SavedReview } from "@/utils/types";
import { ThumbUp } from "./icons";

const IMPACT: Record<string, { label: string; dot: string }> = {
  coding: { label: "Affects coding", dot: "bg-coding" },
  denial: { label: "Could cause a denial", dot: "bg-denial" },
  interpretation: { label: "Could be misread", dot: "bg-interp" },
};

/**
 * The review the companion did on the page, for when the provider opens the panel for more: each
 * suggestion still standing, what to change for the ones they marked useful, and how many they
 * dismissed. The thumbs themselves are given on the page, so this list only shows them.
 */
export function ReviewList({ review }: { review: SavedReview }) {
  const standing = review.suggestions.map((s, i) => ({ s, i })).filter(({ i }) => review.votes[i] !== "down");
  const dismissed = review.suggestions.length - standing.length;
  return (
    <section className="mb-5 flex flex-col gap-2">
      <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">
        Review · {standing.length ? `${standing.length} suggestion${standing.length === 1 ? "" : "s"}` : "nothing critical"}
      </p>
      {standing.map(({ s, i }) => {
        const impact = IMPACT[s.gate.answer] ?? IMPACT.interpretation!;
        const fix = review.fixes[i];
        return (
          <article key={s.id ?? i} className="rounded-xl border border-line bg-raised p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <span className={`h-2 w-2 rounded-full ${impact.dot}`} aria-hidden="true" />
              {impact.label}
              {review.votes[i] === "up" && (
                <span className="ml-auto inline-flex items-center gap-1 text-accent">
                  <ThumbUp className="h-3.5 w-3.5" /> Useful
                </span>
              )}
            </div>
            <p className="mt-1 font-medium text-ink">{s.title}</p>
            {s.quotes.map((q, j) => (
              <p key={j} title={q.text} className="mt-1 line-clamp-3 border-l-2 border-line pl-2 text-[12.5px] text-muted">“{q.text}”</p>
            ))}
            {fix && (
              <div className="mt-2.5 rounded-lg bg-surface p-2.5 text-[13px]">
                <p className="text-ink">{fix.guidance}</p>
                <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
                  {fix.choices.map((c, k) => (
                    <li key={k}>• {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
      {dismissed > 0 && <p className="text-[12px] text-muted">{dismissed} dismissed with a thumbs down.</p>}
    </section>
  );
}
