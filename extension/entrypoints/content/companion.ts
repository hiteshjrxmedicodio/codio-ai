/**
 * The Codio AI companion: one element on the page that follows the pointer and changes shape.
 * Highlight text → it becomes the code card. A medical report → a permission question in the
 * corner, then each diagnosis phrase with its ICD-10 code, the phrases highlighted on the report
 * and each one opening the trail the engine took to its code. Hold ⌘⌥ → it
 * becomes the listening mic and answers in place. Click elsewhere → back to the pill.
 */
import { annotate, clearAnnotations, focusSuggestion } from "./annotate";
import * as card from "./companionUi/cards";
import { icdDetailCard, icdListCard, icdProgressCard, mergeSameCode, sameCodeLeaders, type CodedDiagnosis } from "./companionUi/icdCards";
import { runIcdJob } from "./icdJob";
import * as dock from "./companionUi/dock";
import * as view from "./companionUi/view";
import { readWholeReport } from "./reportReader";
import { consent, fingerprint, pageKey, remember } from "./reportMemory";
import { cptCardHtml, readRun, type CptCard } from "./reportRun";

export { consent };

export type CompanionMode = view.PillMode;

interface Report {
  title: string;
  blocks: { heading: string; text: string }[];
  coverage: { reachedEnd: boolean; steps: number; method: string };
  /** Each diagnosis with the phrases that state it, its code and the trail to that code. */
  icd?: { diagnoses: CodedDiagnosis[]; engineError?: string };
  /** The procedures' CPT codes from the same run. */
  cpt?: CptCard;
  /** The documentation check, run when the provider asks for it from the ICD card. */
  checked: boolean;
  suggestions: card.Suggestion[];
  /** The report as the check split it; a thumbs up's "what to change" is written from these. */
  sections: { name: string; text: string }[];
  votes: Record<number, card.Vote>;
  fixes: Record<number, card.Fix>;
  /** The extension's history record this report is saved in, once saved. */
  recordId?: string;
  /** The chart IDs that record was saved under. */
  ids?: { label: string; value: string }[];
}

let on = false;
let paused = false;
let report: Report | null = null;
let messageTimer = 0;
/** A spoken question waiting for permission to read the report. */
let pendingQuestion: string | null = null;
/** The suggestion open in the review card, or null for the list. */
let viewing: number | null = null;
/** The diagnosis open in the ICD card, or null for the list. */
let viewingDx: number | null = null;
/** The read report's fingerprint, saved with it so a refresh can tell whether it changed. */
let fp = "";
const MAX_SCROLL_STEPS = 60;

const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;

/** Report cards dock to the right edge; code cards open where the pointer is. */
/** Where the last highlight sits, so its code card opens next to it. */
let anchor: DOMRect | undefined;

/**
 * Report results go to their own card in the top-right stack (ICD-10 codes, the documentation
 * review, CPT and final codes, answers), which lets the pill keep following the pointer. Code cards for
 * a highlight open beside it, where the pill turns into them. `focus` opens the card; background
 * updates pass false so they never take over the card being read.
 */
function show(html: string, where: dock.CardId | "pointer" = "review", focus = true): void {
  window.clearTimeout(messageTimer);
  if (where === "pointer") view.openCard(html, "pointer", anchor);
  else dock.setCard(where, html, focus);
}

/** Codes for one of the prediction cards: ICD-10, CPT or the final set. */
export function showPrediction(id: "icd" | "cpt" | "final", codes: card.Code[] | null, focus = false): void {
  if (!on) return;
  show(codes ? card.predictionCard(id, codes) : card.loadingCard(card.PREDICTION_TITLE[id], "Predicting…"), id, focus);
}

/** Card gone, highlight gone: back to the pill that follows the pointer. */
export function dismiss(clearSelection = true): void {
  view.closeCard();
  if (clearSelection) window.getSelection()?.removeAllRanges();
}

// ── Pointer ────────────────────────────────────────────────────────────────
function onMove(e: MouseEvent): void {
  view.follow(e.clientX, e.clientY);
  // The pill stays with the pointer while the docked card is open, but never sits on top of it.
  view.setVisible(!paused && !dock.overDock(e.clientX, e.clientY));
}
function onLeave(e: MouseEvent): void {
  if (!e.relatedTarget) view.setVisible(false);
}
function onDown(e: MouseEvent): void {
  if (!view.isCard()) return;
  const path = e.composedPath() as Element[];
  if (path.some((el) => el?.tagName === "CODIO-AI" || el?.tagName === "CODIO-AI-DOCK" || el?.tagName === "CODIO-MARKS")) return;
  dismiss(false);
}

// ── Card buttons ───────────────────────────────────────────────────────────
async function onPanelClick(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const index = Number(btn.dataset.index);
  if (action === "close") dismiss();
  else if (action === "copy") {
    try {
      await navigator.clipboard.writeText(btn.dataset.code ?? "");
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select it";
    }
  } else if (action === "allow") void readReport();
  else if (action === "deny") {
    remember("declined");
    pendingQuestion = null;
    dock.removeCard("icd");
  } else if (action === "dx") pickDiagnosis(index);
  else if (action === "icd-back") {
    viewingDx = null;
    renderIcd();
  } else if (action === "check") void checkDocumentation();
  else if (action === "goto") pickSuggestion(index);
  else if (action === "up" || action === "down") void vote(index, action);
  else if (action === "back") {
    viewing = null;
    renderReview();
  }
}

// ── Report: permission, reading, ICD codes over the report ─────────────────
/** Turn into the permission question, unless something else is on screen or the provider already answered. */
export function offerPermission(): void {
  if (!on || view.isCard() || dock.hasCard("icd") || report || consent()) return;
  show(card.permissionCard(), "icd");
}

/**
 * The chart shows one set of highlights at a time, numbered like the card they belong to: the
 * diagnosis phrases, or the documentation suggestions while the provider is in that card.
 */
let marked: "icd" | "review" | null = null;
function mark(set: "icd" | "review"): void {
  const r = report;
  if (!r || marked === set) return;
  marked = set;
  // Phrases sharing a code are highlighted as one: all their quotes sit under the first phrase's marker.
  const dx = r.icd?.diagnoses ?? [], lead = sameCodeLeaders(dx);
  if (set === "icd") annotate(dx.map((_, i) => dx.flatMap((d, j) => (lead[j] === i ? d.quotes.map((q) => q.text) : []))), pickDiagnosis);
  else annotate(r.suggestions.map((s, i) => (r.votes[i] === "down" ? [] : s.quotes.map((q) => q.text))), pickSuggestion);
}

/** The ICD card as it stands: one diagnosis with its prediction trail, or every phrase with its code. */
function renderIcd(focus = true): void {
  const r = report;
  if (!r?.icd) return;
  if (viewingDx !== null && r.icd.diagnoses[viewingDx]) show(icdDetailCard(mergeSameCode(r.icd.diagnoses, viewingDx)), "icd", focus);
  else show(icdListCard(r.icd.diagnoses, r.icd.engineError), "icd", focus);
}

/** A phrase clicked on the chart or in the card: open its diagnosis and the trail to its code. */
function pickDiagnosis(index: number): void {
  if (!report?.icd?.diagnoses[index]) return;
  mark("icd");
  index = sameCodeLeaders(report.icd.diagnoses)[index] ?? index;
  viewingDx = index;
  focusSuggestion(index);
  renderIcd();
}

// ── Documentation check (one click from the ICD card): suggestions with thumbs ──
function pickSuggestion(index: number): void {
  if (!report?.suggestions[index]) return;
  mark("review");
  viewing = index;
  focusSuggestion(index);
  renderReview();
}

/** The review card as it stands: one suggestion with its thumbs and fix, or the list. */
function renderReview(focus = true): void {
  const r = report;
  if (!r?.checked) return;
  if (focus) mark("review");
  const s = viewing === null ? undefined : r.suggestions[viewing];
  if (s && viewing !== null) show(card.suggestionCard(s, viewing, r.votes[viewing], r.fixes[viewing]), "review", focus);
  else show(card.suggestionsCard(r.suggestions, r.votes), "review", focus);
}

async function checkDocumentation(): Promise<void> {
  const r = report;
  if (!r) return;
  if (r.checked) return renderReview();
  show(card.loadingCard("Review", "Checking the documentation…"), "review");
  const res = await send<{ suggestions?: card.Suggestion[]; sections?: Report["sections"]; error?: string }>({ type: "report:check", title: r.title, blocks: r.blocks }).catch(() => ({ error: "unreachable" }));
  if (report !== r) return;
  if ("error" in res && res.error) return show(card.messageCard("Review", "I couldn't check the documentation right now."), "review");
  const ok = res as { suggestions?: card.Suggestion[]; sections?: Report["sections"] };
  Object.assign(r, { suggestions: ok.suggestions ?? [], sections: ok.sections ?? [], checked: true });
  renderReview();
  persist();
}

/**
 * A thumbs on a suggestion, logged to the same feedback file as the panel's. Down drops it from
 * this note; up writes what to change, shown in its card.
 */
async function vote(index: number, dir: card.Vote): Promise<void> {
  const r = report;
  const s = r?.suggestions[index];
  if (!r || !s) return;
  const retry = dir === "up" && r.fixes[index] === "error";
  if (r.votes[index] === dir && !retry) return;
  if (r.votes[index] !== dir) send({ type: "review:feedback", suggestion: s, vote: dir }).catch(() => undefined);
  r.votes[index] = dir;
  if (dir === "down") {
    delete r.fixes[index];
    if (viewing === index) viewing = null;
    marked = null;
    mark("review");
    renderReview();
    return persist();
  }
  viewing = index;
  focusSuggestion(index);
  r.fixes[index] = "loading";
  renderReview();
  const res = await send<{ fix?: { guidance: string; choices: string[] } }>({ type: "review:fix", suggestion: s, sections: r.sections }).catch(() => ({ fix: undefined }));
  if (report !== r) return;
  r.fixes[index] = res.fix ?? "error";
  // The provider may be reading another card by now; the review card updates without taking over.
  renderReview(false);
  persist();
}

let saving: Promise<unknown> = Promise.resolve();

/**
 * Keep the report's results where the extension keeps them: the History record (ICD codes,
 * questions, the documentation check and its thumbs, under the chart's IDs) and this session's
 * copy for a refresh. Saves run one after another so the first one's record is the one the rest update.
 */
function persist(addQa?: { q: string; a: string }[]): void {
  const r = report;
  if (!r) return;
  saving = saving.then(async () => {
    const fixes = Object.fromEntries(Object.entries(r.fixes).filter(([, f]) => typeof f === "object"));
    const review = r.checked ? { suggestions: r.suggestions, votes: r.votes, fixes } : undefined;
    const save = { recordId: r.recordId, title: r.title, blocks: r.recordId ? undefined : r.blocks, review, icd: r.icd, addQa };
    const saved = await send<{ id?: string; ids?: Report["ids"] }>({ type: "review:save", save }).catch(() => null);
    if (saved?.id) {
      r.recordId = saved.id;
      r.ids = saved.ids;
    }
    await send({ type: "report:remember", key: pageKey(), entry: { fingerprint: fp, report: { ...r, fixes } } }).catch(() => undefined);
  });
}

interface Remembered {
  fingerprint: string;
  report: Report;
}

/** Highlight each diagnosis phrase on the report and show them with their codes. */
function present(r: Report): void {
  report = { ...r, suggestions: r.suggestions ?? [], votes: r.votes ?? {}, fixes: r.fixes ?? {}, sections: r.sections ?? [] };
  viewing = viewingDx = null;
  marked = null;
  mark("icd");
  renderIcd();
  if (report.cpt) show(cptCardHtml(report.cpt), "cpt", false);
  if (report.checked) renderReview(false);
}

/**
 * After a refresh, on a report the provider already said yes to this session: read it again and,
 * when its words are unchanged, bring the last codes straight back without running the pipeline.
 */
export function resumeReport(): void {
  if (on && !report) void readReport(true);
}

/**
 * Read the whole report and run the ICD pipeline on it: the phrases that state each diagnosis,
 * then a code for each. With `reuse`, a report whose words match the last run this session shows
 * that run's codes instead of running it again.
 */
async function readReport(reuse = false): Promise<void> {
  remember("allowed");
  // Only talk about bringing codes back when there is an earlier run to bring back.
  const saved = reuse ? await send<Remembered | null>({ type: "report:recall", key: pageKey() }).catch(() => null) : null;
  const usable = saved?.report?.icd ? saved : null;
  show(card.loadingCard("ICD-10 codes", usable ? "Bringing back your codes…" : "Reading the whole report…"), "icd");
  try {
    const page = await readWholeReport(MAX_SCROLL_STEPS);
    fp = await fingerprint(page.blocks);
    if (usable) {
      if (usable.fingerprint === fp) return present(usable.report);
      show(card.loadingCard("ICD-10 codes", "The report changed since last time. Coding it again…"), "icd");
    }
    const coverage = { reachedEnd: page.reachedEnd, steps: page.steps, method: "the full report" };
    showPrediction("cpt", null);
    const { icd, cpt } = readRun(await runIcdJob(page.blocks, (step) => show(icdProgressCard(step), "icd"), "codes"));
    present({ title: document.title, blocks: page.blocks, coverage, icd, cpt, suggestions: [], sections: [], votes: {}, fixes: {}, checked: false });
    persist();
    if (pendingQuestion) {
      const q = pendingQuestion;
      pendingQuestion = null;
      void askByVoice(q);
    }
  } catch (err) {
    show(card.messageCard("ICD-10 codes", `I couldn't code this report. ${String(err instanceof Error ? err.message : err)}`), "icd");
    dock.removeCard("cpt");
  }
}

// ── Voice questions ────────────────────────────────────────────────────────
/** Answer a spoken question in place: from the report once read, or ask to read it first. */
export async function askByVoice(question: string, looksClinical = false): Promise<void> {
  if (!report) {
    if (looksClinical && consent() !== "declined") {
      pendingQuestion = question;
      show(card.permissionCard(), "icd");
    } else {
      show(card.answerCard(question, "Open a medical report and let me read it first."), "answer");
    }
    return;
  }
  show(card.loadingCard("Your question", "Looking in the report…"), "answer");
  const text = report.blocks.map((b) => (b.heading ? `--- ${b.heading}\n${b.text}` : b.text)).join("\n\n");
  const r = await send<{ answer?: string; error?: string }>({ type: "report:ask", title: report.title, report: text, question });
  show(card.answerCard(question, r.answer ?? "I couldn't answer that right now."), "answer");
  // Kept with the report's record, like a question asked in the panel.
  if (r.answer) persist([{ q: question, a: r.answer }]);
}

// ── Highlight-to-code ──────────────────────────────────────────────────────
export function showCodesLoading(at?: DOMRect): void {
  anchor = at;
  show(card.loadingCard("Codio AI", "Checking the highlighted text…"), "pointer");
}
export function showCodes(result: { kind: string; icd: card.Code[]; cpt: card.Code[] }): void {
  if (result.kind === "neither" || (!result.icd.length && !result.cpt.length)) {
    show(card.messageCard("Codio AI", "This isn't a diagnosis or procedure I can code."), "pointer");
    messageTimer = window.setTimeout(() => dismiss(false), 1800);
    return;
  }
  show(card.codesCard(result.kind, result.icd, result.cpt), "pointer");
}
export function showCodesError(): void {
  show(card.messageCard("Codio AI", "I couldn't code this right now."), "pointer");
}

// ── Pill modes and lifecycle ───────────────────────────────────────────────
/** Push-to-talk and short notes. Listening always clears any card and highlight first. */
export function setCompanionMode(mode: CompanionMode, text = ""): void {
  if (!on) return;
  if (view.isCard() && mode !== "idle") dismiss();
  window.clearTimeout(messageTimer);
  view.setPill(mode, text);
  if (mode === "message") messageTimer = window.setTimeout(() => view.setPill("idle"), 3500);
  // Never stuck on a spinner if nothing answers.
  if (mode === "working") messageTimer = window.setTimeout(() => setCompanionMode("message", "That took too long. Try again."), 60_000);
}

export function companionOn(): void {
  if (on) return;
  on = true;
  view.mount((e) => void onPanelClick(e));
  dock.mountDock((e) => void onPanelClick(e));
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("mouseout", onLeave);
  document.addEventListener("mousedown", onDown, true);
}

export function companionOff(): void {
  on = false;
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseout", onLeave);
  document.removeEventListener("mousedown", onDown, true);
  clearAnnotations();
  view.unmount();
  dock.unmountDock();
  report = null;
  viewing = viewingDx = null;
  marked = null;
}

/** Dictation's fill tag is the cursor while fill mode is armed; the companion waits. */
export function companionPause(pause: boolean): void {
  paused = pause;
  view.setVisible(!pause);
}

export const isOn = () => on;
