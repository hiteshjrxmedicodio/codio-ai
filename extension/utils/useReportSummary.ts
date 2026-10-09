import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { recallReport } from "./bg/reportCache";
import { findChartIds, type ChartId } from "./chartIds";
import { loadChat, markOpened, saveChat } from "./chatStore";
import { observe, overrideGate } from "./observe";
import { loadPreferences } from "./settings";
import { summarizeOpenReport } from "./readReport";
import { isOwnTab } from "./tab";
import { useChartIdOffer } from "./useChartIdOffer";
import type { AgentSettings, PageGate, ReportQA, ReportSummary, SavedDiagnosis, SavedReview } from "./types";

type SavedIcd = { diagnoses: SavedDiagnosis[]; engineError?: string };

interface CompanionRead {
  summary?: ReportSummary;
  icd?: SavedIcd;
  checked?: boolean;
  suggestions?: SavedReview["suggestions"];
  votes?: SavedReview["votes"];
  fixes?: Record<number, unknown>;
  recordId?: string;
  ids?: ChartId[];
}

/**
 * What the Codio AI companion on the page already did with this report this session (its review,
 * thumbs and summary), kept by the extension under the page's address without its query.
 */
async function companionRead(url: string): Promise<CompanionRead | null> {
  try {
    const u = new URL(url);
    const entry = (await recallReport(`codio-consent:${u.origin}${u.pathname}`)) as { report?: CompanionRead } | null;
    return entry?.report ?? null;
  } catch {
    return null;
  }
}

const reviewOf = (r: CompanionRead): SavedReview => ({
  suggestions: r.suggestions ?? [],
  votes: r.votes ?? {},
  fixes: Object.fromEntries(Object.entries(r.fixes ?? {}).filter(([, f]) => typeof f === "object")) as SavedReview["fixes"],
});

/** permission: a report is open and waits for the provider's yes before anything on screen moves. */
export type SummaryPhase = "idle" | "not_report" | "permission" | "reading" | "done" | "error";

/**
 * Summary-only mode. Each time a report opens, the privacy gate runs. A clinical page is NOT read
 * straight away: reading it scrolls the provider's screen, so the panel asks first, and only a
 * yes for that report starts the read and the field-by-field summary. Summaries are kept per page so switching tabs
 * back and forth does not read the same report twice.
 */
export function useReportSummary(settings: AgentSettings | null) {
  const [phase, setPhase] = useState<SummaryPhase>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [error, setError] = useState("");
  /** Questions about the report on screen, kept per page. */
  const [qa, setQa] = useState<ReportQA[]>([]);
  const qaByPage = useRef(new Map<string, ReportQA[]>());
  const [asking, setAsking] = useState(false);
  const [gate, setGate] = useState<PageGate | null>(null);
  const pageKey = useRef("");
  /** The page on screen, as state, so the view can fade between pages instead of jumping. */
  const [viewKey, setViewKey] = useState("");
  const busy = useRef(false);
  /** The page being read, which may no longer be the one on screen; and its progress lines. */
  const readingKey = useRef("");
  const stepsByKey = useRef(new Map<string, string[]>());
  const done = useRef(new Map<string, ReportSummary>());
  /** Pages the provider said yes to, so a reload or a tab switch back does not ask twice. */
  const allowed = useRef(new Set<string>());
  /** IDs shown on the open report, and the saved record (if any) this summary lives in. */
  const [pageIds, setPageIds] = useState<ChartId[]>([]);
  const record = useRef<{ id: string; ids: ChartId[] } | null>(null);
  const records = useRef(new Map<string, { id: string; ids: ChartId[] }>());
  const idOffer = useChartIdOffer("summary");
  /** An ID the provider said to save before the summary existed; it is saved once the read finishes. */
  const pendingId = useRef<ChartId | null>(null);
  const [kind, setKind] = useState("");
  /** The companion's review of the page on screen, or of a reopened record; kept per page. */
  const [review, setReview] = useState<SavedReview | null>(null);
  const reviews = useRef(new Map<string, SavedReview>());
  /** The companion's ICD codes for the page on screen, or of a reopened record; kept per page. */
  const [icd, setIcd] = useState<SavedIcd | null>(null);
  const icds = useRef(new Map<string, SavedIcd>());

  const limits = settings && {
    maxScrollSteps: settings.report?.max_scroll_steps ?? 60,
    maxScreens: settings.report?.max_screens ?? 20,
    domMinChars: settings.agent.dom_min_chars,
    backgroundTab: settings.report?.background_tab ?? false,
    backgroundLoadSeconds: settings.report?.background_load_seconds ?? 30,
  };

  const read = useCallback(async () => {
    if (!limits || busy.current) return;
    busy.current = true;
    // Results belong to the page the read started on, even if the provider switches tabs meanwhile.
    const key = pageKey.current;
    readingKey.current = key;
    stepsByKey.current.set(key, []);
    const onScreen = () => pageKey.current === key;
    setPhase("reading");
    setSteps([]);
    setError("");
    try {
      const result = await summarizeOpenReport(limits, (t) => {
        const list = [...(stepsByKey.current.get(key) ?? []), t];
        stepsByKey.current.set(key, list);
        if (onScreen()) setSteps(list);
      });
      done.current.set(key, result);
      if (!onScreen()) return;
      setSummary(result);
      if (pendingId.current) {
        const rec = { id: record.current?.id ?? `s${Date.now()}`, ids: [...(record.current?.ids ?? []), pendingId.current] };
        pendingId.current = null;
        record.current = rec;
        records.current.set(pageKey.current, rec);
        void persist(rec, result, []);
      } else if (pageIds.length) {
        void idOffer.consider(pageIds, record.current?.ids ?? [], record.current?.id ?? "", (id) => {
          const rec = { id: record.current?.id ?? `s${Date.now()}`, ids: [...(record.current?.ids ?? []), id] };
          record.current = rec;
          records.current.set(pageKey.current, rec);
          void persist(rec, result, []);
        });
      }
      qaByPage.current.delete(pageKey.current);
      setQa([]);
      setPhase("done");
    } catch (err) {
      if (!onScreen()) return;
      setError(String(err instanceof Error ? err.message : err));
      setPhase("error");
    } finally {
      busy.current = false;
      readingKey.current = "";
      stepsByKey.current.delete(key);
      // The provider moved on during the read: look at their page now (it may be waiting its turn).
      if (!onScreen()) window.setTimeout(() => void checkRef.current?.(), 0);
    }
  }, [limits?.maxScrollSteps, limits?.maxScreens, limits?.domMinChars, limits?.backgroundTab, pageIds, idOffer.consider]);

  const checkRef = useRef<(() => Promise<void>) | null>(null);

  /** Gate the current page, then show its saved summary or read it. */
  const check = useCallback(async () => {
    if (!settings) return;
    try {
      const seen = await observe(settings.agent.dom_min_chars, false);
      setViewKey(seen.key);
      setGate(seen.gate);
      if (pageKey.current !== seen.key) {
        idOffer.clear();
        pendingId.current = null;
      }
      pageKey.current = seen.key;
      record.current = records.current.get(seen.key) ?? null;
      const found = seen.gate.status === "clinical" ? findChartIds(seen.obs.blocks ?? [], settings.agent.chart_id_labels ?? []) : [];
      setPageIds(found);
      setKind(seen.gate.kind);
      // The companion on the page already read this report: its results are shown, nothing is read again.
      const onPage = readingKey.current === seen.key ? null : await companionRead(seen.obs.url);
      if (onPage) {
        if (onPage.checked) reviews.current.set(seen.key, reviewOf(onPage));
        if (onPage.icd) icds.current.set(seen.key, onPage.icd);
        if (onPage.summary) done.current.set(seen.key, onPage.summary);
        if (onPage.recordId) {
          record.current = { id: onPage.recordId, ids: onPage.ids ?? [] };
          records.current.set(seen.key, record.current);
          // Questions asked by voice on the page are in the record; the panel's list starts from them.
          if (!qaByPage.current.has(seen.key)) qaByPage.current.set(seen.key, (await loadChat(onPage.recordId).catch(() => null))?.qa ?? []);
        }
      }
      setReview(reviews.current.get(seen.key) ?? null);
      setIcd(icds.current.get(seen.key) ?? null);
      const saved = done.current.get(seen.key);
      if (readingKey.current === seen.key) {
        // Back on the page being read: show its progress where it is.
        setSteps(stepsByKey.current.get(seen.key) ?? []);
        setPhase("reading");
      } else if (saved) {
        setSummary(saved);
        setQa(qaByPage.current.get(seen.key) ?? []);
        setPhase("done");
      } else if (onPage) {
        // Coded on the page by the companion; no summary to show.
        setSummary(null);
        setQa(qaByPage.current.get(seen.key) ?? []);
        setPhase("done");
      } else if (seen.gate.status !== "clinical") {
        setSummary(null);
        setQa(qaByPage.current.get(seen.key) ?? []);
        setPhase("not_report");
      } else if ((allowed.current.has(seen.key) || (await loadPreferences().catch(() => null))?.autoCheck) && !busy.current) {
        // A yes for this page, or the standing yes in Settings (Read notes without asking).
        allowed.current.add(seen.key);
        await read();
      } else {
        // Ask first. A summary saved before under this report's ID can be opened without reading.
        setSummary(null);
        setQa(qaByPage.current.get(seen.key) ?? []);
        setPhase("permission");
        if (found.length) void idOffer.consider(found, [], "", () => undefined, true);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setPhase("error");
    }
  }, [settings, read]);
  checkRef.current = check;

  useEffect(() => {
    if (!settings) return;
    let timer: number | undefined;
    // A tab switch is answered at once (its gate is usually cached); a page load waits for the page to settle.
    const soon = (ms = 1000) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, ms);
    };
    const onActivated = (info: { tabId: number }) => void isOwnTab(info.tabId).then((own) => own && soon(120));
    const onUpdated = (id: number, info: { status?: string }) =>
      info.status === "complete" && void isOwnTab(id).then((own) => own && soon());
    // The companion saved a review, a thumbs or a summary: show it without waiting for a tab switch.
    const onStored = (changes: Record<string, unknown>, area: string) =>
      area === "session" && Object.keys(changes).some((k) => k.startsWith("codio-report:")) && !busy.current && soon(300);
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.storage.onChanged.addListener(onStored);
    soon();
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.storage.onChanged.removeListener(onStored);
      window.clearTimeout(timer);
    };
  }, [settings, check]);

  /** The provider's yes: read this report (it scrolls the screen) and summarise it. */
  const allow = useCallback(() => {
    if (!pageKey.current) return;
    allowed.current.add(pageKey.current);
    if (busy.current) {
      // One read at a time: this report goes next, as soon as the other tab's read is done.
      setSteps(["Waiting for the report in your other tab to finish"]);
      setPhase("reading");
      return;
    }
    void read();
  }, [read]);

  const readAnyway = useCallback(() => {
    if (!pageKey.current) return;
    overrideGate(pageKey.current);
    allowed.current.add(pageKey.current);
    setGate((g) => (g ? { ...g, status: "clinical", kind: "other_clinical", setting: "unknown" } : g));
    void read();
  }, [read]);

  const again = useCallback(() => {
    done.current.delete(pageKey.current);
    void read();
  }, [read]);

  // Questions belong to the page they were asked on, and to its saved record when there is one.
  useEffect(() => {
    if (pageKey.current) qaByPage.current.set(pageKey.current, qa);
    if (record.current && summary) void persist(record.current, summary, qa);
  }, [qa]);

  async function persist(rec: { id: string; ids: ChartId[] }, s: ReportSummary, q: ReportQA[]) {
    if (!settings) return;
    const limits = { maxChats: settings.agent.history_max_chats, keepDays: settings.agent.history_keep_days };
    await saveChat(
      { id: rec.id, title: s.report_type || "Report summary", updatedAt: Date.now(), items: [], history: [], ids: rec.ids, kind, type: "summary", summary: s, qa: q },
      limits,
    ).catch(() => undefined);
  }

  /** Show a saved summary and its questions without reading anything on screen. */
  const openSaved = useCallback(async (id: string) => {
    const saved = await loadChat(id);
    if (!saved?.summary && !saved?.review && !saved?.icd) return;
    markOpened(id).catch(() => undefined);
    const rec = { id: saved.id, ids: saved.ids ?? [] };
    record.current = rec;
    if (pageKey.current) {
      records.current.set(pageKey.current, rec);
      if (saved.summary) done.current.set(pageKey.current, saved.summary);
      if (saved.review) reviews.current.set(pageKey.current, saved.review);
      if (saved.icd) icds.current.set(pageKey.current, saved.icd);
    }
    setSummary(saved.summary ?? null);
    setReview(saved.review ?? null);
    setIcd(saved.icd ?? null);
    setQa(saved.qa ?? []);
    setError("");
    setPhase("done");
  }, []);

  /** Yes opens the summary saved under the ID; no keeps the ID with this summary (once it exists). */
  const answerIdOffer = useCallback(
    (accept: boolean) => {
      const offer = accept ? idOffer.offer : idOffer.decline();
      if (!offer) return;
      if (accept) {
        idOffer.clear();
        return void openSaved(offer.match.id);
      }
      if (!summary) {
        pendingId.current = offer.id;
        return;
      }
      const rec = { id: record.current?.id ?? `s${Date.now()}`, ids: [...(record.current?.ids ?? []), offer.id] };
      record.current = rec;
      if (pageKey.current) records.current.set(pageKey.current, rec);
      void persist(rec, summary, qa);
    },
    [idOffer, openSaved, summary, qa],
  );

  /** Answer a question from the report that was read. Without one, say what to do instead. */
  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      if (!summary) {
        const a =
          phase === "not_report"
            ? "This page isn't a medical report, so I haven't read it. Open a report, or choose Read it anyway above."
            : phase === "reading"
              ? "I'm still reading the report. Ask again in a moment."
              : "Open a report and I'll read it first.";
        setQa((list) => [...list, { q, a }]);
        return;
      }
      setAsking(true);
      try {
        const tab = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        const { answer } = await api.askReport({ title: tab[0]?.title ?? "", report: summary.text, question: q, earlier: qa.slice(-6) });
        setQa((list) => [...list, { q, a: answer }]);
      } catch (err) {
        setQa((list) => [...list, { q, a: `I couldn't answer that: ${String(err instanceof Error ? err.message : err)}` }]);
      } finally {
        setAsking(false);
      }
    },
    [summary, phase, qa],
  );

  return {
    phase, steps, summary, review, icd, error, gate, kind, viewKey, again, allow, readAnyway, qa, asking, ask,
    idOffer: idOffer.offer, answerIdOffer, openSaved, recordId: record.current?.id ?? "",
  };
}
