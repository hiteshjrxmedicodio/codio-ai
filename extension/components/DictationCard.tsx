import { useEffect, useRef } from "react";
import type { useDictation } from "@/utils/useDictation";
import { Check, Close, Mic, Square } from "./icons";

type Dictation = ReturnType<typeof useDictation>;

/** The words heard so far, kept scrolled to the latest line while the provider talks. */
function LiveText({ text, live }: { text: string; live: boolean }) {
  const end = useRef<HTMLSpanElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [text]);
  return (
    <p className="min-h-16 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink" aria-live="polite">
      {text || <span className="text-muted">{live ? "Start speaking. Your words appear here every few seconds." : ""}</span>}
      {live && text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent/60 align-middle" aria-hidden="true" />}
      <span ref={end} />
    </p>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The dictated note as report sections, editable, with fill mode: while it is on, clicking an
 * empty field on the page fills it with the section that belongs there.
 */
export function DictationCard({ d }: { d: Dictation }) {
  if (d.phase === "idle") return null;

  if (d.phase === "recording" || d.phase === "working") {
    const live = d.phase === "recording";
    return (
      <div className="mx-3 mb-2 flex max-h-[45vh] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-[0_1px_2px_rgba(3,4,90,0.05)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 animate-pulse rounded-full ${live ? "bg-coding" : "bg-accent"}`} aria-hidden="true" />
          <span className="flex-1 text-[13px] font-semibold text-ink">
            {live ? (
              <>
                Live transcription <span className="ml-1 font-normal text-muted tabular-nums">{clock(d.seconds)}</span>
              </>
            ) : (
              "Organising your note into sections…"
            )}
          </span>
          {live && (
            <button type="button" onClick={d.stop} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-fg">
              <Square className="h-3 w-3" /> Done
            </button>
          )}
          <button type="button" onClick={d.discard} aria-label="Discard dictation" title="Discard" className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
            <Close />
          </button>
        </div>
        <LiveText text={d.transcript} live={live} />
      </div>
    );
  }

  if (d.phase === "error") {
    return (
      <div className="mx-3 mb-2 flex items-start gap-3 rounded-xl border border-coding/30 bg-coding/5 px-3 py-2.5">
        <p className="flex-1 text-[12.5px] text-ink">{d.error}</p>
        <button type="button" onClick={d.start} className="rounded-full border border-line px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-surface">
          Try again
        </button>
        <button type="button" onClick={d.discard} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
          <Close />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 flex max-h-[50vh] flex-col overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex-1 text-[13px] font-semibold text-ink">Dictated note</span>
        <button
          type="button"
          onClick={d.filling ? d.disarm : d.arm}
          className={`rounded-full px-3 py-1 text-[12px] font-medium ${d.filling ? "bg-accent text-accent-fg" : "border border-line text-ink hover:bg-surface"}`}
        >
          {d.filling ? "Filling: on" : "Fill fields"}
        </button>
        <button type="button" onClick={d.start} aria-label="Dictate again" title="Dictate again" className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
          <Mic />
        </button>
        <button type="button" onClick={d.discard} aria-label="Discard dictated note" title="Discard" className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
          <Close />
        </button>
      </div>
      {d.filling && (
        <p className="border-b border-line bg-accent/5 px-3 py-1.5 text-[12px] text-ink">
          Click an empty field on the page and the matching part goes in. Press Esc to stop.
        </p>
      )}
      <div className="flex flex-col gap-2.5 overflow-y-auto px-3 py-2.5">
        {d.sections.map((s) => (
          <label key={s.name} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
              {s.title}
              {d.filled.includes(s.name) && (
                <span className="inline-flex items-center gap-0.5 font-medium text-ok normal-case">
                  <Check className="h-3 w-3" /> filled
                </span>
              )}
            </span>
            <textarea
              value={s.text}
              onChange={(e) => d.edit(s.name, e.target.value)}
              rows={Math.min(6, Math.max(1, Math.ceil(s.text.length / 48)))}
              className="w-full resize-y rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent/40"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
