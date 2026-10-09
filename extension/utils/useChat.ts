import { useCallback, useEffect, useRef, useState } from "react";
import { runAgent } from "./agentLoop";
import { api } from "./api";
import { chatTitle, loadChat, markOpened, saveChat } from "./chatStore";
import { findChartIds, type ChartId } from "./chartIds";
import { addChartSite, declineChartSite, shouldOfferSite, siteOf } from "./chartSites";
import { isOwnTab } from "./tab";
import { useChartIdOffer } from "./useChartIdOffer";
import { observe, overrideGate, rememberCheck, type Observed } from "./observe";
import { loadPreferences } from "./settings";
import type { AgentSettings, AttachedDoc, CareSetting, ChatItem, PageGate } from "./types";

const NOTE_KINDS = new Set(["operative", "enm", "inpatient"]);

let counter = 0;
const newId = () => `m${Date.now()}-${counter++}`;
const newChatId = () => `c${Date.now()}-${counter++}`;

/** Chat state, the agent loop, and the page watcher that greets each new page. */
export function useChat(settings: AgentSettings | null) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<PageGate | null>(null);
  const [pageKey, setPageKey] = useState("");
  const history = useRef<unknown[]>([]);
  const abort = useRef<AbortController | null>(null);
  const greeting = useRef(false);
  const [chatId, setChatId] = useState(newChatId);
  /** Set when a past chat is reopened, so viewing it does not count as an update. */
  const justOpened = useRef(false);
  /** The chart this conversation is about: its identifiers and kind of note, for the past-chats list. */
  const chart = useRef<{ ids: ChartId[]; kind: string; page?: string } | null>(null);
  const idOffer = useChartIdOffer("chat");
  /** Bumped when a chart ID is saved, so the conversation is stored again with it. */
  const [idsVersion, setIdsVersion] = useState(0);
  /** A site to offer saving as a chart site, shown above the input until answered. */
  const [siteOffer, setSiteOffer] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  /** Every document attached in this conversation; the agent sees all of them on every turn. */
  const docs = useRef<AttachedDoc[]>([]);

  const add = useCallback((item: Omit<ChatItem, "id">) => setItems((list) => [...list, { ...item, id: newId() }]), []);

  /**
   * Remember which kind of chart the conversation is about, and return the IDs shown on it.
   * IDs are only kept once the provider says so (see answerIdOffer); a chat that has not started
   * yet follows the provider to whichever chart they open.
   */
  const noteChart = useCallback(
    (seen: Observed, started: boolean): ChartId[] => {
      setPageUrl(seen.obs.url);
      if (seen.gate.status !== "clinical") return [];
      if (!chart.current || (!started && chart.current.page !== seen.key)) chart.current = { ids: [], kind: seen.gate.kind, page: seen.key };
      return findChartIds(seen.obs.blocks ?? [], settings?.agent.chart_id_labels ?? []);
    },
    [settings],
  );

  /**
   * Run the gate on the current page. What the panel can read is shown only by the indicator
   * next to the input, never as chat lines; a newly opened note is checked automatically.
   */
  const greetPage = useCallback(async () => {
    if (!settings || greeting.current) return;
    greeting.current = true;
    try {
      const seen = await observe(settings.agent.dom_min_chars, false);
      setGate(seen.gate);
      setPageKey(seen.key);
      const found = noteChart(seen, items.length > 0);
      if (!seen.firstReadable) return;
      if (found.length) {
        void idOffer.consider(found, chart.current?.ids ?? [], chatId, (id) => {
          chart.current = { ...(chart.current ?? { kind: seen.gate.kind }), ids: [...(chart.current?.ids ?? []), id] };
          setIdsVersion((v) => v + 1);
        });
      }
      if (!seen.chartSite && (await shouldOfferSite(seen.obs.url))) setSiteOffer(seen.obs.url);
      const { autoCheck } = await loadPreferences();
      if (settings.agent.auto_check_on_new_note && autoCheck && NOTE_KINDS.has(seen.gate.kind)) {
        add({ role: "step", text: "Checking the documentation" });
        const setting = seen.gate.setting as CareSetting;
        const shots = seen.obs.blocks?.length ? undefined : seen.obs.screenshot ? [seen.obs.screenshot] : undefined;
        const result = await api.checkPage(seen.obs.blocks, shots, setting);
        rememberCheck(seen.key, result);
        const n = result.suggestions.length;
        add({ role: "assistant", text: n ? `${n} thing${n > 1 ? "s" : ""} worth a look before you sign:` : "Nothing critical stood out in this note.", check: result, setting });
      }
    } catch (err) {
      add({ role: "status", text: `Could not read this page: ${String(err instanceof Error ? err.message : err)}` });
    } finally {
      greeting.current = false;
    }
  }, [settings, add, noteChart, items.length, idOffer.consider, chatId]);

  useEffect(() => {
    if (!settings) return;
    let timer: number | undefined;
    // A tab switch is answered at once; page loads and changes wait for the page to settle.
    const soon = (ms = 900) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(greetPage, ms);
    };
    // Only events about the tab this panel is docked in count.
    const onActivated = (info: { tabId: number }) => void isOwnTab(info.tabId).then((own) => own && soon(120));
    const onUpdated = (id: number, info: { status?: string }) =>
      info.status === "complete" && void isOwnTab(id).then((own) => own && soon());
    // The content script says when the page's content changed and settled, which is when a
    // single-page app finishes drawing the note after its own load event.
    const onMessage = (message: { type?: string }, sender: { tab?: { id?: number } }) => {
      if (message?.type === "page:changed") void isOwnTab(sender.tab?.id).then((own) => own && soon());
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.runtime.onMessage.addListener(onMessage);
    soon();
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.runtime.onMessage.removeListener(onMessage);
      window.clearTimeout(timer);
    };
  }, [settings, greetPage]);

  const run = useCallback(
    async (text: string) => {
      if (!settings) return;
      setBusy(true);
      abort.current = new AbortController();
      try {
        history.current = await runAgent(text, history.current, settings, {
          say: (t, final) => add({ role: final ? "assistant" : "step", text: t }),
          status: (t) => add({ role: "step", text: t }),
          check: (result, setting) => add({ role: "assistant", text: "", check: result, setting: (setting === "none" ? "unknown" : setting) as CareSetting }),
        }, abort.current.signal, docs.current);
      } catch (err) {
        if (!abort.current.signal.aborted) add({ role: "status", text: `Something went wrong: ${String(err instanceof Error ? err.message : err)}` });
      } finally {
        setBusy(false);
      }
    },
    [settings, add],
  );

  /**
   * On a page the gate closed, ask before reading instead of answering blind. The question waits
   * on the permission item and runs once the provider answers.
   */
  const send = useCallback(
    async (text: string, attachments: AttachedDoc[] = []) => {
      if (!settings || (!text.trim() && !attachments.length)) return;
      add({ role: "user", text: text.trim(), attachments: attachments.length ? attachments : undefined });
      const known = new Set(docs.current.map((d) => d.name));
      docs.current = [...docs.current, ...attachments.filter((d) => !known.has(d.name))];
      const question = text.trim() || (attachments.length > 1 ? "Please review the attached documents." : "Please review the attached document.");
      // Look again before deciding: the indicator may predate the note finishing loading.
      const seen = docs.current.length ? null : await observe(settings.agent.dom_min_chars, false).catch(() => null);
      if (seen) {
        setGate(seen.gate);
        setPageKey(seen.key);
        noteChart(seen, true);
      }
      const current = seen?.gate ?? gate;
      // Attached documents are shared by choice: no need to ask about the page before answering.
      if (!docs.current.length && current && current.status !== "clinical") {
        add({ role: "assistant", text: "This page doesn't look like a patient chart. Should I read it?", ask: { question, answered: false } });
        return;
      }
      void run(question);
    },
    [settings, gate, add, run],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  /** Save the conversation whenever a turn settles, once it holds something worth reopening. */
  useEffect(() => {
    if (justOpened.current) {
      justOpened.current = false;
      return;
    }
    if (!settings || busy || !items.some((i) => i.role === "user" || i.role === "assistant")) return;
    const limits = { maxChats: settings.agent.history_max_chats, keepDays: settings.agent.history_keep_days };
    const about = chart.current ?? undefined;
    saveChat(
      { id: chatId, title: chatTitle(items), updatedAt: Date.now(), items, history: history.current, ids: about?.ids, kind: about?.kind, type: "chat" },
      limits,
    ).catch(() => undefined);
  }, [settings, busy, items, chatId, idsVersion]);

  const newChat = useCallback(() => {
    abort.current?.abort();
    history.current = [];
    docs.current = [];
    chart.current = null;
    idOffer.clear();
    setItems([]);
    setChatId(newChatId());
  }, []);

  /** Reopen a past conversation where it left off. Unanswered read requests are closed, not replayed. */
  const openChat = useCallback(async (id: string) => {
    const chat = await loadChat(id);
    if (!chat) return;
    markOpened(id).catch(() => undefined);
    abort.current?.abort();
    history.current = chat.history;
    docs.current = chat.items.flatMap((i) => i.attachments ?? []);
    justOpened.current = true;
    chart.current = chat.kind || chat.ids?.length ? { ids: chat.ids ?? [], kind: chat.kind ?? "other_clinical" } : null;
    idOffer.clear();
    setItems(chat.items.map((i) => (i.ask ? { ...i, ask: { ...i.ask, answered: true } } : i)));
    setChatId(chat.id);
  }, []);

  /**
   * The provider's answer to a permission item. Yes reopens the gate for this page only and runs
   * the waiting question; no runs it without the page, which the service enforces too.
   */
  const answerAsk = useCallback(
    (id: string, allow: boolean, always = false) => {
      const item = items.find((i) => i.id === id);
      if (!item?.ask || item.ask.answered) return;
      if (always && pageUrl) {
        void addChartSite(pageUrl);
        setSiteOffer(null);
      }
      setItems((list) => list.map((i) => (i.id === id && i.ask ? { ...i, ask: { ...i.ask, answered: true } } : i)));
      if (allow && pageKey) {
        overrideGate(pageKey);
        setGate((g) => (g ? { ...g, status: "clinical", kind: "other_clinical", setting: "unknown" } : g));
      }
      void run(item.ask.question);
    },
    [items, pageKey, pageUrl, run],
  );

  /** The provider's answer to the offer to save this site as where they read charts. */
  const answerSiteOffer = useCallback(
    (remember: boolean) => {
      if (!siteOffer) return;
      void (remember ? addChartSite(siteOffer) : declineChartSite(siteOffer));
      setSiteOffer(null);
    },
    [siteOffer],
  );

  /** Keep a chart ID with this chat, so History can find the chat by it. */
  const saveId = useCallback(
    (id: ChartId) => {
      chart.current = { ...(chart.current ?? { kind: gate?.kind ?? "other_clinical" }), ids: [...(chart.current?.ids ?? []), id] };
      setIdsVersion((v) => v + 1);
    },
    [gate],
  );

  /** Yes opens the chat saved under the ID; no keeps the ID with this chat instead. */
  const answerIdOffer = useCallback(
    (accept: boolean) => {
      const offer = accept ? idOffer.offer : idOffer.decline();
      if (!offer) return;
      if (accept) {
        idOffer.clear();
        void openChat(offer.match.id);
      } else saveId(offer.id);
    },
    [idOffer, openChat, saveId],
  );

  return {
    items, busy, gate, chatId, send, stop, answerAsk, newChat, openChat,
    idOffer: idOffer.offer, answerIdOffer,
    siteOffer: siteOffer ? siteOf(siteOffer) : null,
    answerSiteOffer,
  };
}
