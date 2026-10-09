import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { api } from "@/utils/api";
import { micPermission, openMicSettings, requestMicAccess } from "@/utils/micAccess";
import { MicPermissionError, Recorder } from "@/utils/recorder";
import type { AttachedDoc, PageGate } from "@/utils/types";
import { ACCEPT, useAttachments } from "@/utils/useAttachments";
import { PendingChips } from "./AttachmentChips";
import { MicSetup, type MicSetupState } from "./MicSetup";
import { MicMenu } from "./MicMenu";
import { ArrowUp, Close, Mic, Plus, Square } from "./icons";

interface Props {
  busy: boolean;
  gate: PageGate | null;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string, attachments: AttachedDoc[]) => void;
  onStop: () => void;
  /** Summary-only mode asks about the open report: no attachments, its own placeholder. */
  reportMode?: boolean;
  /** When given, the mic first asks whether to speak a message or live-transcribe a note. */
  onLiveTranscribe?: () => void;
}

type MicState = "idle" | "recording" | "transcribing";

const KIND: Record<string, string> = { operative: "Procedure note", enm: "Visit note", inpatient: "Hospital note", other_clinical: "Clinical page" };

/** Shown only while the assistant can read the page. Any other page shows nothing; it asks first. */
function ReadingChip({ gate }: { gate: PageGate | null }) {
  if (gate?.status !== "clinical") return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-[12px] font-medium text-ok" title="I can read this page">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
      Reading: {KIND[gate.kind] ?? "This page"}
    </span>
  );
}

export function Composer({ busy, gate, draft, onDraft, onSend, onStop, reportMode = false, onLiveTranscribe }: Props) {
  const [mic, setMic] = useState<MicState>("idle");
  const [micMenu, setMicMenu] = useState(false);
  const closeMicMenu = useCallback(() => setMicMenu(false), []);
  const [hint, setHint] = useState("");
  const [micReady, setMicReady] = useState(false);
  const [setup, setSetup] = useState<MicSetupState | null>(null);
  const recorder = useRef(new Recorder());
  const files = useAttachments();
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Access can also arrive from the popup fallback or from Settings: light the mic up for a moment.
  useEffect(() => {
    const onMessage = (m: { type?: string }) => {
      if (m?.type !== "mic:granted") return;
      setSetup((s) => (s === "asking" ? s : null));
      setMicReady(true);
      window.setTimeout(() => setMicReady(false), 5000);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function send() {
    if (!canSend) return;
    onSend(draft.trim(), files.ready);
    files.clear();
    onDraft("");
    setHint("");
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function toggleMic() {
    if (mic === "transcribing") return;
    if (mic === "recording") {
      setMic("transcribing");
      setHint("Writing down what you said…");
      try {
        const { base64, mimeType } = await recorder.current.stop();
        const r = await api.transcribe(base64, mimeType);
        onDraft(draft ? `${draft} ${r.text}` : r.text);
        setHint("");
        box.current?.focus();
      } catch (err) {
        setHint(`Couldn't hear that clearly. ${String(err instanceof Error ? err.message : err)}`);
      } finally {
        setMic("idle");
      }
      return;
    }
    try {
      setMicReady(false);
      await recorder.current.start();
      setMic("recording");
      setHint("Listening. Tap the microphone again when you're done.");
    } catch (err) {
      if (err instanceof MicPermissionError) {
        setHint("");
        setSetup((await micPermission()) === "denied" ? "blocked" : "needed");
      } else {
        setHint("The microphone isn't available.");
      }
    }
  }

  /** Ask Chrome from inside the panel; once allowed, start listening straight away. */
  async function turnOnMic() {
    setSetup("asking");
    const answer = await requestMicAccess();
    if (answer !== "granted") {
      setSetup("blocked");
      return;
    }
    setSetup("done");
    window.setTimeout(() => setSetup(null), 2500);
    try {
      await recorder.current.start();
      setMic("recording");
    } catch {
      setSetup("blocked");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) files.add([...e.dataTransfer.files]);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (!pasted.length) return;
    e.preventDefault();
    files.add(pasted);
  }

  const canSend = !busy && !files.reading && (Boolean(draft.trim()) || files.ready.length > 0);
  return (
    <div className="shrink-0 px-3 pb-2">
      {setup && <MicSetup state={setup} onTurnOn={turnOnMic} onOpenSettings={openMicSettings} onDismiss={() => setSetup(null)} />}
      {hint && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-[12px] text-muted" role="status">
          <Mic className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{hint}</span>
          <button type="button" onClick={() => setHint("")} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:text-ink">
            <Close className="h-3 w-3" />
          </button>
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative rounded-2xl border bg-raised p-2 shadow-[0_1px_3px_rgba(60,45,20,0.06)] transition-[border-color,box-shadow] focus-within:border-muted/40 focus-within:shadow-[0_2px_10px_rgba(60,45,20,0.08)] ${dragging ? "border-accent border-dashed" : "border-line"}`}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-raised/90 text-[13px] font-medium text-ink">
            Drop to attach
          </div>
        )}
        <PendingChips files={files.files} onRemove={files.remove} />
        <label htmlFor="composer" className="sr-only">Message</label>
        <textarea
          id="composer"
          ref={box}
          rows={1}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={mic === "recording" ? "Listening…" : reportMode ? "Ask about this report" : files.files.length ? "Ask about this document" : "Ask anything about this chart"}
          className="block max-h-40 w-full resize-none appearance-none border-0 bg-transparent px-1.5 py-1 text-ink caret-accent shadow-none ring-0 outline-none placeholder:text-muted focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:outline-none"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {!reportMode && (
              <>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={files.full}
              aria-label="Attach a chart report or file"
              title={files.full ? "Attachment limit reached" : "Attach a chart report (PDF, image or text)"}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
            >
              <Plus />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                if (e.target.files?.length) files.add([...e.target.files]);
                e.target.value = "";
              }}
            />
              </>
            )}
            <ReadingChip gate={gate} />
          </div>
          <div className="relative ml-auto flex items-center gap-1">
            {micMenu && onLiveTranscribe && <MicMenu onSpeak={toggleMic} onLiveTranscribe={onLiveTranscribe} onClose={closeMicMenu} />}
            <button
              type="button"
              onClick={() => (mic === "idle" && onLiveTranscribe ? setMicMenu((open) => !open) : toggleMic())}
              aria-haspopup={onLiveTranscribe && mic === "idle" ? "menu" : undefined}
              aria-expanded={onLiveTranscribe && mic === "idle" ? micMenu : undefined}
              aria-label={mic === "recording" ? "Stop listening" : "Speak"}
              title={mic === "recording" ? "Stop listening" : "Speak"}
              className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${mic === "recording" ? "animate-pulse bg-coding text-white" : micReady ? "bg-accent text-accent-fg ring-4 ring-accent/15" : "text-muted hover:bg-surface hover:text-ink"} ${mic === "transcribing" ? "opacity-50" : ""}`}
            >
              {mic === "recording" ? <Square /> : <Mic />}
            </button>
            {busy ? (
              <button type="button" onClick={onStop} aria-label="Stop" title="Stop" className="grid h-8 w-8 place-items-center rounded-full bg-ink text-bg">
                <Square />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                aria-label="Send"
                title="Send"
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-fg transition-colors disabled:opacity-35"
              >
                <ArrowUp />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
