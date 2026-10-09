import { Dictate, Gear, History, Plus } from "./icons";

/** The panel is docked in the page; closing asks the background to undock it from this tab. */

interface Props {
  online: boolean | null;
  /** Left out in summary-only mode, which has no conversation. */
  onNewChat?: () => void;
  onHistory?: () => void;
  /** Start dictating a note that can then fill fields on the page. */
  onDictate?: () => void;
  onSettings: () => void;
  onRetry: () => void;
}

/** Slim bar: Medicodio logo, connection dot, new chat, past chats, settings. Nothing else competes with the conversation. */
export function TopBar({ online, onNewChat, onHistory, onDictate, onSettings, onRetry }: Props) {
  const dot = online === null ? "bg-muted" : online ? "bg-ok" : "bg-coding";
  const status = online === null ? "Connecting" : online ? "Connected" : "Offline";
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-bg px-3">
      <div className="flex items-center gap-2">
        <img src="/medicodio-logo.png" alt="Medicodio" className="h-7 w-auto select-none" draggable={false} />
        <button type="button" onClick={onRetry} title={`${status}. Tap to reconnect.`} aria-label={`${status}. Reconnect`} className="grid h-5 w-5 place-items-center">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        </button>
      </div>
      <div className="flex items-center gap-0.5 text-muted">
        {onDictate && (
          <button type="button" onClick={onDictate} title="Dictate a note" aria-label="Dictate a note" className="rounded-md p-1.5 hover:bg-surface hover:text-ink">
            <Dictate />
          </button>
        )}
        {onNewChat && (
          <button type="button" onClick={onNewChat} title="New chat" aria-label="New chat" className="rounded-md p-1.5 hover:bg-surface hover:text-ink">
            <Plus />
          </button>
        )}
        {onHistory && (
          <button type="button" onClick={onHistory} title="History" aria-label="History" className="rounded-md p-1.5 hover:bg-surface hover:text-ink">
            <History />
          </button>
        )}
        <button type="button" onClick={onSettings} title="Settings" aria-label="Settings" className="rounded-md p-1.5 hover:bg-surface hover:text-ink">
          <Gear />
        </button>
      </div>
    </header>
  );
}
