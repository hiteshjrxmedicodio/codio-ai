import { useEffect, useRef } from "react";
import { Dictate, Mic } from "./icons";

interface Props {
  onSpeak: () => void;
  onLiveTranscribe: () => void;
  onClose: () => void;
}

/**
 * What the microphone is for this time: a quick spoken message in the chat box, or a live
 * transcription of a whole note that can then fill the chart. Opens above the mic button.
 */
export function MicMenu({ onSpeak, onLiveTranscribe, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    box.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const option = (icon: React.ReactNode, title: string, help: string, onPick: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        onPick();
      }}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/8 text-accent">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <span className="text-[12px] leading-snug text-muted">{help}</span>
      </span>
    </button>
  );

  return (
    <div
      ref={box}
      role="menu"
      aria-label="Microphone"
      className="absolute right-0 bottom-full z-20 mb-2 w-[min(300px,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-1.5 shadow-[0_8px_28px_rgba(3,4,90,0.14)]"
    >
      {option(<Mic />, "Speak a message", "Talk instead of typing. Your words go into the message box.", onSpeak)}
      {option(<Dictate />, "Live transcribe a note", "Dictate a full note and watch it written as you speak, then fill the chart.", onLiveTranscribe)}
    </div>
  );
}
