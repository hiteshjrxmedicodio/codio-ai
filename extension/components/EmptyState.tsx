interface Props {
  canRead: boolean;
  onPick: (text: string) => void;
}

const STARTERS = ["Check this note before I sign", "What's unclear in the assessment?", "Find today's progress note"];

/** First screen: one line of what it does, three things to try. */
export function EmptyState({ canRead, onPick }: Props) {
  return (
    <div className="m-auto flex w-full max-w-[320px] flex-col items-center gap-5 px-2 text-center">
      <div>
        <p className="text-[18px] font-semibold text-ink">How can I help with this chart?</p>
        <p className="mt-1 text-[13px] text-muted">
          {canRead ? "I can read the note on your screen, point things out, and check it before you sign." : "Open a patient chart and I'll read it with you."}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-line bg-raised px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-surface"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
