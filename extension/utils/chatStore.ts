import type { ChartId } from "./chartIds";
import type { ChatItem, ReportQA, ReportSummary, SavedDiagnosis, SavedReview } from "./types";

/** One past conversation as the history list shows it. */
export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  /** When the provider last reopened it from History; drives the Recently opened list. */
  openedAt?: number;
  /** Identifiers of the chart the conversation was about, read from the page. */
  ids?: ChartId[];
  /** The kind of note, as the privacy gate named it. */
  kind?: string;
  /** A conversation, or a report summary saved under a chart ID (summary-only mode). */
  type?: "chat" | "summary";
}

/** Everything needed to reopen a conversation and keep talking: what was shown and the agent's history. */
export interface SavedChat extends ChatSummary {
  items: ChatItem[];
  history: unknown[];
  /** Summary-only mode: the report summary and the questions asked about it. */
  summary?: ReportSummary;
  qa?: ReportQA[];
  /** The on-page review: suggestions and the provider's thumbs on them. */
  review?: SavedReview;
  /** The on-page ICD run: each diagnosis phrase with its code. */
  icd?: { diagnoses: SavedDiagnosis[]; engineError?: string };
}

export interface StoreLimits {
  maxChats: number;
  keepDays: number;
}

const INDEX_KEY = "codio-chats";
const chatKey = (id: string) => `codio-chat:${id}`;
const DAY_MS = 86_400_000;

/**
 * Screenshots are dropped before saving, the same way the service drops older ones. They are the
 * bulk of the size and the service only ever uses the latest, which a reopened chat takes fresh.
 */
function withoutImages(history: unknown[]): unknown[] {
  return history.map((c) => {
    const content = c as { parts?: Array<Record<string, unknown>> };
    if (!content.parts?.some((p) => p.inlineData)) return c;
    return { ...content, parts: content.parts.map((p) => (p.inlineData ? { text: "[earlier screenshot removed]" } : p)) };
  });
}

/** The provider's first question, or what the first answer was about when the chat began with a check. */
export function chatTitle(items: ChatItem[]): string {
  const first = items.find((i) => i.role === "user")?.text ?? (items.some((i) => i.check) ? "Documentation check" : "Conversation");
  const line = first.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

async function readIndex(): Promise<ChatSummary[]> {
  const stored = await browser.storage.local.get(INDEX_KEY);
  return (stored[INDEX_KEY] as ChatSummary[] | undefined) ?? [];
}

/** Past conversations, newest first. Expired ones are deleted on the way. */
export async function listChats(limits: StoreLimits): Promise<ChatSummary[]> {
  const index = await readIndex();
  // A service older than these limits sends none; keep everything rather than prune on NaN.
  if (!(limits.keepDays > 0 && limits.maxChats > 0)) return [...index].sort((x, y) => y.updatedAt - x.updatedAt);
  const cutoff = Date.now() - limits.keepDays * DAY_MS;
  const keep = index.filter((c) => c.updatedAt >= cutoff).sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = keep.slice(0, limits.maxChats);
  const gone = index.filter((c) => !kept.some((k) => k.id === c.id));
  if (gone.length) {
    await browser.storage.local.remove(gone.map((c) => chatKey(c.id)));
    await browser.storage.local.set({ [INDEX_KEY]: kept });
  }
  return kept;
}

export async function loadChat(id: string): Promise<SavedChat | null> {
  const stored = await browser.storage.local.get(chatKey(id));
  return (stored[chatKey(id)] as SavedChat | undefined) ?? null;
}

export async function saveChat(chat: SavedChat, limits: StoreLimits): Promise<void> {
  // The panel re-saves a summary when questions are asked; the codes and review the companion saved stay.
  const before = chat.type === "summary" && (!chat.review || !chat.icd) ? await loadChat(chat.id) : null;
  const record: SavedChat = { ...chat, review: chat.review ?? before?.review, icd: chat.icd ?? before?.icd, history: withoutImages(chat.history) };
  const all = await readIndex();
  const openedAt = all.find((c) => c.id === chat.id)?.openedAt;
  const index = all.filter((c) => c.id !== chat.id);
  index.unshift({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, openedAt, ids: chat.ids, kind: chat.kind, type: chat.type });
  await browser.storage.local.set({ [chatKey(chat.id)]: record, [INDEX_KEY]: index });
  await listChats(limits);
}

/** The newest saved record carrying this chart ID, other than `exceptId`. IDs are matched exactly. */
export async function findChatById(value: string, exceptId?: string, type?: ChatSummary["type"]): Promise<ChatSummary | null> {
  const index = await readIndex();
  return (
    index
      .filter((c) => c.id !== exceptId && (!type || (c.type ?? "chat") === type) && (c.ids ?? []).some((i) => i.value === value))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
}

/** Record that a conversation was reopened, so it shows under Recently opened. */
export async function markOpened(id: string): Promise<void> {
  const index = await readIndex();
  const now = Date.now();
  await browser.storage.local.set({ [INDEX_KEY]: index.map((c) => (c.id === id ? { ...c, openedAt: now } : c)) });
}

export async function deleteChat(id: string): Promise<void> {
  const index = (await readIndex()).filter((c) => c.id !== id);
  await browser.storage.local.remove(chatKey(id));
  await browser.storage.local.set({ [INDEX_KEY]: index });
}

export async function clearChats(): Promise<void> {
  const index = await readIndex();
  await browser.storage.local.remove([INDEX_KEY, ...index.map((c) => chatKey(c.id))]);
}
