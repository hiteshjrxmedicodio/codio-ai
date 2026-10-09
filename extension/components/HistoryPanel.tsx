import { useEffect, useState } from "react";
import { deleteChat, listChats, type ChatSummary, type StoreLimits } from "@/utils/chatStore";
import { Close, Plus, Search, Trash } from "./icons";

interface Props {
  limits: StoreLimits;
  currentId: string;
  onOpen: (id: string) => void;
  onDeletedCurrent: () => void;
  /** Left out for saved summaries, which have no new-chat action. */
  onNewChat?: () => void;
  onClose: () => void;
  /** Which saved records to list: conversations, or report summaries (summary-only mode). */
  type?: "chat" | "summary";
}

const DAY_MS = 86_400_000;
/** How many reopened conversations sit at the top under Recently opened. */
const RECENT_COUNT = 5;

/** Today, Yesterday, This week, Earlier: the buckets people scan a chat list by. */
function bucket(time: number): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (time >= startOfToday) return "Today";
  if (time >= startOfToday - DAY_MS) return "Yesterday";
  if (time >= startOfToday - 6 * DAY_MS) return "This week";
  return "Earlier";
}

const KIND: Record<string, string> = { operative: "Procedure note", enm: "Visit note", inpatient: "Hospital note" };

function when(time: number): string {
  const d = new Date(time);
  return time >= new Date().setHours(0, 0, 0, 0)
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A sheet over the chat listing past conversations, kept on this computer only. */
export function HistoryPanel({ limits, currentId, onOpen, onDeletedCurrent, onNewChat, onClose, type = "chat" }: Props) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listChats(limits)
      .then((all) => setChats(all.filter((c) => (c.type ?? "chat") === type)))
      .catch(() => setChats([]));
  }, [limits]);

  async function remove(id: string) {
    await deleteChat(id);
    setChats((list) => (list ?? []).filter((c) => c.id !== id));
    if (id === currentId) onDeletedCurrent();
  }

  /** Clears only what this list shows: saved summaries in summary mode, conversations otherwise. */
  async function clearAll() {
    for (const c of chats ?? []) await deleteChat(c.id);
    setChats([]);
    setConfirmClear(false);
    onDeletedCurrent();
  }

  // Recently opened: conversations reopened from here, latest first. History: everything else, by date.
  // Search matches the title and any saved chart ID, ignoring case and spacing.
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  const shown = (chats ?? []).filter((c) => !q || [c.title, ...(c.ids ?? []).map((i) => i.value)].some((t) => t.toLowerCase().replace(/\s+/g, "").includes(q)));
  const recent = shown
    .filter((c) => c.openedAt)
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
    .slice(0, RECENT_COUNT);
  const recentIds = new Set(recent.map((c) => c.id));
  const groups = new Map<string, ChatSummary[]>();
  for (const c of shown.filter((x) => !recentIds.has(x.id))) groups.set(bucket(c.updatedAt), [...(groups.get(bucket(c.updatedAt)) ?? []), c]);

  const noun = type === "summary" ? "summaries" : "conversations";

  /**
   * One record. Title in the text face, the time right-aligned in tabular figures (the delete
   * button takes its place on hover, so the right edge stays aligned with the header), then the chart
   * line: each ID as a label (text face) and value (monospace, so characters are unambiguous), and
   * the kind of note.
   */
  const row = (c: ChatSummary, time: number) => {
    const current = c.id === currentId;
    return (
      <li
        key={c.id}
        className={`group relative rounded-xl border bg-raised shadow-[0_1px_2px_rgba(3,4,90,0.05)] transition-[border-color,box-shadow] hover:border-accent/30 hover:shadow-[0_2px_8px_rgba(3,4,90,0.08)] ${current ? "border-accent/40 ring-2 ring-accent/10" : "border-line"}`}
      >
        <button type="button" onClick={() => onOpen(c.id)} className="flex w-full min-w-0 flex-col gap-2 rounded-xl px-4 py-3.5 text-left">
          <span className="flex items-baseline justify-between gap-4">
            <span className="truncate text-[14px] leading-snug font-medium text-ink">{c.title}</span>
            <span className="shrink-0 text-[12px] text-muted tabular-nums group-focus-within:invisible group-hover:invisible">{when(time)}</span>
          </span>
          {(Boolean(c.ids?.length) || KIND[c.kind ?? ""]) && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {(c.ids ?? []).map((id) => (
                <span key={id.value} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface px-1.5 py-0.5">
                  <span className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{id.label}</span>
                  <span className="truncate font-mono text-[12px] text-ink">{id.value}</span>
                </span>
              ))}
              {KIND[c.kind ?? ""] && <span className="text-[12px] text-muted">{KIND[c.kind ?? ""]}</span>}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => remove(c.id)}
          aria-label={`Delete “${c.title}”`}
          title="Delete"
          className="absolute top-2.5 right-2.5 rounded-md p-1.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface hover:text-coding focus-visible:opacity-100"
        >
          <Trash />
        </button>
      </li>
    );
  };

  const section = (label: string, list: ChatSummary[], timeOf: (c: ChatSummary) => number) => (
    <section key={label} className="flex flex-col gap-2.5">
      <h2 className="px-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</h2>
      <ul className="flex flex-col gap-2">{list.map((c) => row(c, timeOf(c)))}</ul>
    </section>
  );

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
        <h1 className="text-[16px] font-semibold tracking-tight text-brand">History</h1>
        <div className="-mr-1.5 flex items-center gap-0.5 text-muted">
          {onNewChat && (
            <button type="button" onClick={onNewChat} title="New chat" aria-label="New chat" className="rounded-md p-1.5 hover:bg-surface hover:text-ink">
              <Plus />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close history" title="Close" className="rounded-md p-1.5 hover:bg-surface hover:text-ink">
            <Close />
          </button>
        </div>
      </header>

      {Boolean(chats?.length) && (
        <div className="shrink-0 px-5 pt-4 pb-2">
          <label className="relative block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
              <Search />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by chart ID or title"
              aria-label="Search history"
              className="h-10 w-full rounded-xl border border-line bg-raised pr-3 pl-9 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent/40 focus:ring-4 focus:ring-accent/10"
            />
          </label>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 pt-3 pb-5">
        {chats?.length === 0 && (
          <div className="m-auto flex max-w-[280px] flex-col items-center gap-1.5 px-5 text-center">
            <p className="text-[15px] font-semibold text-ink">No saved {noun} yet</p>
            <p className="text-[13px] leading-relaxed text-muted">
              {type === "summary" ? "Summaries are saved under their chart ID, so you can find them here." : "Your conversations appear here as you have them."}
            </p>
          </div>
        )}
        {Boolean(chats?.length) && !shown.length && (
          <p className="m-auto px-5 text-center text-[13px] text-muted">Nothing matches “{query}”.</p>
        )}
        {recent.length > 0 && section("Recently opened", recent, (c) => c.openedAt ?? c.updatedAt)}
        {[...groups].map(([label, list]) => section(label, list, (c) => c.updatedAt))}
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-line px-5">
        <span className="text-[12px] text-muted">Kept on this computer for {limits.keepDays} days</span>
        {Boolean(chats?.length) &&
          (confirmClear ? (
            <span className="flex shrink-0 items-center gap-3 text-[12.5px]">
              <button type="button" onClick={clearAll} className="font-semibold text-coding hover:underline">Delete all</button>
              <button type="button" onClick={() => setConfirmClear(false)} className="font-medium text-muted hover:text-ink">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="shrink-0 text-[12.5px] font-medium text-muted hover:text-ink">
              Clear all
            </button>
          ))}
      </footer>
    </div>
  );
}
