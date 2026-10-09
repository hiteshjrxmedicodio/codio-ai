import { useState } from "react";
import { api } from "@/utils/api";
import type { CareSetting, FixReply, Section, Suggestion } from "@/utils/types";
import { ThumbDown, ThumbUp } from "./icons";

const IMPACT: Record<string, { label: string; dot: string }> = {
  coding: { label: "Affects coding", dot: "bg-coding" },
  denial: { label: "Could cause a denial", dot: "bg-denial" },
  interpretation: { label: "Could be misread", dot: "bg-interp" },
};

interface Props {
  suggestion: Suggestion;
  sections: Section[];
  setting: CareSetting;
}

/** One suggestion: why it matters, what it is, the words it is about, and a yes/no. */
export function SuggestionCard({ suggestion, sections, setting }: Props) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [fix, setFix] = useState<FixReply | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const impact = IMPACT[suggestion.gate.answer] ?? IMPACT.interpretation!;

  async function up() {
    if (vote === "up") return;
    setVote("up");
    setLoading(true);
    api.feedback(suggestion, "up", setting).catch(() => undefined);
    try {
      setFix((await api.fix(suggestion, sections, setting)).fix);
    } catch {
      setError("Couldn't write the suggestion right now.");
    } finally {
      setLoading(false);
    }
  }

  function down() {
    setVote("down");
    api.feedback(suggestion, "down", setting).catch(() => undefined);
  }

  if (vote === "down") {
    return <p className="rounded-xl border border-dashed border-line px-3 py-2 text-[12.5px] text-muted">Got it. I won't raise this again on this note.</p>;
  }

  return (
    <article className="rounded-xl border border-line bg-raised p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <span className={`h-2 w-2 rounded-full ${impact.dot}`} aria-hidden="true" />
        {impact.label}
      </div>
      <p className="mt-1 font-medium text-ink">{suggestion.title}</p>
      {suggestion.quotes.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {suggestion.quotes.map((q, i) => (
            <p key={i} className="border-l-2 border-line pl-2 text-[12.5px] text-muted">
              “{q.text}”
            </p>
          ))}
        </div>
      )}

      {fix && (
        <div className="mt-2.5 rounded-lg bg-surface p-2.5 text-[13px]">
          <p className="text-ink">{fix.guidance}</p>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
            {fix.choices.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      )}
      {loading && <p className="mt-2 text-[12.5px] text-muted">Writing what to change…</p>}
      {error && <p className="mt-2 text-[12.5px] text-coding">{error}</p>}

      <div className="mt-2 flex items-center gap-1 text-muted">
        <span className="mr-1 text-[11.5px]">{fix ? "Helpful?" : "Useful?"}</span>
        <button type="button" onClick={up} aria-label="Useful, show what to change" aria-pressed={vote === "up"} title="Useful, show what to change"
          className={`rounded-md p-1 hover:bg-surface hover:text-ink ${vote === "up" ? "text-accent" : ""}`}>
          <ThumbUp />
        </button>
        <button type="button" onClick={down} aria-label="Not useful" title="Not useful" className="rounded-md p-1 hover:bg-surface hover:text-ink">
          <ThumbDown />
        </button>
      </div>
    </article>
  );
}
