import type { IdOffer } from "@/utils/useChartIdOffer";

interface Props {
  offer: IdOffer;
  /** What a saved record is called here: chat or summary. */
  noun: string;
  onAccept: () => void;
  onDecline: () => void;
}

const day = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

/** Shown only when something was saved under this chart's ID before: open it, or carry on here. */
export function ChartIdOffer({ offer, noun, onAccept, onDecline }: Props) {
  return (
    <div className="mx-3 mb-2 flex flex-col gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2.5">
      <p className="text-[12.5px] leading-snug text-ink">
        You have a {noun} for{" "}
        <span className="font-mono font-medium">
          {offer.id.label} {offer.id.value}
        </span>{" "}
        from {day(offer.match.updatedAt)}. Open it?
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onAccept} className="rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-fg">
          Open {noun}
        </button>
        <button type="button" onClick={onDecline} className="rounded-full px-3 py-1 text-[12.5px] font-medium text-muted hover:bg-surface hover:text-ink">
          Not now
        </button>
      </div>
    </div>
  );
}
