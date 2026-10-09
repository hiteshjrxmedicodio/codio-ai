import { Check, Close, Mic } from "./icons";

export type MicSetupState = "needed" | "asking" | "blocked" | "done";

interface Props {
  state: MicSetupState;
  onTurnOn: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

const COPY: Record<MicSetupState, { title: string; body: string }> = {
  needed: { title: "Turn on your microphone", body: "Chrome asks once. After that, just tap the mic and talk." },
  asking: { title: "Choose Allow at the top of the window", body: "Chrome is asking whether Codio can use your microphone." },
  blocked: { title: "The microphone is blocked", body: "Allow Codio in Chrome's settings, then tap the mic again." },
  done: { title: "Microphone is on", body: "Listening now. Tap the mic again when you're done." },
};

/** Microphone setup, inside the panel. Chrome's own Allow bubble is the only thing outside it. */
export function MicSetup({ state, onTurnOn, onOpenSettings, onDismiss }: Props) {
  const tone =
    state === "done" ? "border-ok/30 bg-ok/5" : state === "blocked" ? "border-coding/30 bg-coding/5" : "border-line bg-raised";
  const badge = state === "done" ? "bg-ok/15 text-ok" : state === "blocked" ? "bg-coding/10 text-coding" : "bg-surface text-ink/70";
  return (
    <div className={`mb-2 flex items-start gap-3 rounded-xl border p-3 ${tone}`} role="status" aria-live="polite">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${badge} ${state === "asking" ? "animate-pulse" : ""}`}>
        {state === "done" ? <Check className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{COPY[state].title}</p>
        <p className="text-[12px] leading-snug text-muted">{COPY[state].body}</p>
        {state === "needed" && (
          <button type="button" onClick={onTurnOn} className="mt-2 rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-fg hover:opacity-90">
            Turn on
          </button>
        )}
        {state === "blocked" && (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onOpenSettings} className="rounded-full border border-line bg-bg px-3.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-surface">
              Open Chrome settings
            </button>
            <button type="button" onClick={onTurnOn} className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-accent hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
      {state !== "asking" && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-muted hover:text-ink">
          <Close className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
