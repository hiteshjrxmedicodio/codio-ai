/**
 * The Codio AI companion: one element on the page that follows the pointer and changes shape.
 * Highlight text → it becomes the code card. A medical report → a permission question in the
 * corner, then each diagnosis phrase with its ICD-10 code, the phrases highlighted on the report
 * and each one opening the trail the engine took to its code. Hold ⌘⌥ → it
 * becomes the listening mic and answers in place. Click elsewhere → back to the pill.
 */
import { annotate, clearAnnotations, focusSuggestion } from "./annotate";
import { closeIssue, openIssue, refreshIssue } from "./issueCard";
import * as card from "./companionUi/cards";
import { icdDetailCard, icdListCard, mergeSameCode, sameCodeLeaders, type CodedDiagnosis } from "./companionUi/icdCards";
import { follow, isCoding, startCoding, type CodedReport } from "./reportJobs";
import * as dock from "./companionUi/dock";
import * as view from "./companionUi/view";
import { readWholeReport } from "./reportReader";
import { consent, fingerprint, pageKey, remember } from "./reportMemory";
import { renderRun, runAction, type RunView } from "./reportRun";
import { answerByVoice } from "./voiceQuestion";

export { consent };

export type CompanionMode = view.PillMode;

interface Report {
  title: string;
  blocks: { heading: string; text: string }[];
  coverage: { reachedEnd: boolean; steps: number; method: string };
  /** Each diagnosis with the phrases that state it, its code and the trail to that code. */
  icd?: { diagnoses: CodedDiagnosis[]; engineError?: string };
  /** The same run's CDI (sections it cleaned) and CPT pipeline (procedures and their journeys). */
  run?: RunView;
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

/**
 * Report results go to their own card in the top-right stack (ICD-10 codes, the documentation
 * review, CPT and final codes, answers), which lets the pill keep following the pointer. `focus` opens
 * the card; background updates pass false so they never take over the card being read. (Code cards for
 * a highlight, which open beside it where the pill turns into them, live in codeCard.ts.)
 */
function show(html: string, where: dock.CardId = "review", focus = true): void {
  window.clearTimeout(messageTimer);
  dock.setCard(where, html, focus);
}

/** Codes for one of the prediction cards: ICD-10, CPT or the final set. */
export function showPrediction(id: "icd" | "cpt" | "final", codes: card.Code[] | null, focus = false): void {
  if (!on) return;
  show(codes ? card.predictionCard(id, codes) : card.loadingCard(card.PREDICTION_TITLE[id], "Predicting…"), id, focus);
}

/** Card gone, highlight gone: back to the pill that follows the pointer. */
export function dismiss(clearSelection = true): void {
  closeIssue();
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
  if (runAction(action, index, report?.run, show)) return;
  if (action === "copy") {
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
    dock.removeCard("cdi");
  } else if (action === "dx") pickDiagnosis(index);
  else if (action === "icd-back") {
    viewingDx = null;
    renderIcd();
  } else if (action === "check") void checkDocumentation();
  else if (action === "goto") pickSuggestion(index);
  else if (action === "up" || action === "down") void vote(index, action);
  else if (action === "back") {
    dismiss(false);
    viewing = null;
    renderReview();
  }
}

// ── Report: permission, reading, ICD codes over the report ─────────────────
/** Turn into the permission question, unless something else is on screen or the provider already answered. */
export function offerPermission(): void {
  if (!on || view.isCard() || dock.hasCard("cdi") || report) return;
  show(card.permissionCard(), "cdi");
}

/**
 * The chart shows one set of highlights at a time, for the card they belong to: the
 * diagnosis phrases, or the documentation suggestions while the provider is in that card.
 */
let marked: "icd" | "review" | null = null;
function mark(set: "icd" | "review"): void {
  const r = report;
  if (!r || marked === set) return;
  marked = set;
  if (set === "icd") annotate((r.icd?.diagnoses ?? []).map((d) => d.quotes.map((q) => q.text)), pickDiagnosis);
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
  viewingDx = index;
  // The clicked phrase leads; every phrase sharing its code stands out with it, as they share one trail.
  const lead = sameCodeLeaders(report.icd.diagnoses);
  focusSuggestion([index, ...lead.flatMap((l, i) => (i !== index && l === lead[index] ? [i] : []))]);
  renderIcd();
}

// ── Documentation check (one click from the ICD card): suggestions with thumbs ──
/** A suggestion's words clicked on the report (or its row in the list): the card opens beside the words. */
function pickSuggestion(index: number): void {
  const r = report;
  if (!r?.suggestions[index]) return;
  mark("review");
  viewing = index;
  focusSuggestion(index, false);
  // Words that could not be found on the page fall back to the review card in the stack.
  const beside = openIssue(r, index);
  renderReview(!beside);
  void loadFix(index);
}

/** The review card (never taking over) and the card beside the words, when it shows this suggestion. */
function redraw(index: number): void {
  renderReview(false);
  if (report) refreshIssue(report, index);
}

/** What to change for one suggestion, written the first time it is opened, or again after a failure. */
async function loadFix(index: number): Promise<void> {
  const r = report;
  const s = r?.suggestions[index];
  if (!r || !s || r.votes[index] === "down" || (r.fixes[index] && r.fixes[index] !== "error")) return;
  r.fixes[index] = "loading";
  redraw(index);
  const res = await send<{ fix?: { guidance: string; choices: string[] } }>({ type: "review:fix", suggestion: s, sections: r.sections }).catch(() => ({ fix: undefined }));
  if (report !== r) return;
  r.fixes[index] = res.fix ?? "error";
  redraw(index);
  persist();
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
 * this note (its card closes); up keeps it, and fetches what to change again if that had failed.
 */
async function vote(index: number, dir: card.Vote): Promise<void> {
  const r = report;
  const s = r?.suggestions[index];
  if (!r || !s) return;
  if (r.votes[index] === dir) return dir === "up" ? loadFix(index) : undefined;
  send({ type: "review:feedback", suggestion: s, vote: dir }).catch(() => undefined);
  r.votes[index] = dir;
  if (dir === "down") {
    delete r.fixes[index];
    if (viewing === index) viewing = null;
    dismiss(false);
    marked = null;
    mark("review");
    renderReview();
    return persist();
  }
  redraw(index);
  persist();
  return loadFix(index);
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
  if (report.run) renderRun(show, report.run);
  if (report.checked) renderReview(false);
}

/** "Read notes without asking" is on: code the report without asking, reusing its last codes if its words are unchanged. */
export function resumeReport(): void {
  if (on && !report) void readReport(true);
}

/**
 * Read the whole report and code it as this page's job (reportJobs, the report run: CDI, then ICD-10 and
 * CPT): leaving does not stop it, other reports can code meanwhile, and coming back follows it. With
 * `reuse`, unchanged words show the last codes.
 */
async function readReport(reuse = false): Promise<void> {
  const key = pageKey();
  const here = () => pageKey() === key;
  try {
    if (!isCoding(key)) {
      const saved = reuse ? await send<Remembered | null>({ type: "report:recall", key }).catch(() => null) : null;
      const usable = saved?.report?.icd || saved?.report?.run ? saved : null;
      show(card.loadingCard("Medical coding", usable ? "Bringing back your codes…" : "Reading the whole report…"), "cdi");
      const page = await readWholeReport(MAX_SCROLL_STEPS);
      if (!here()) return;
      const print = await fingerprint(page.blocks);
      if (usable?.fingerprint === print) return void ((fp = print), present(usable.report));
      if (usable) show(card.loadingCard("Medical coding", "The report changed since last time. Coding it again…"), "cdi");
      remember("allowed");
      // A job for this page may have started while the report was read (a second click): follow that one.
      const coverage = { reachedEnd: page.reachedEnd, steps: page.steps, method: "the full report" };
      if (!isCoding(key)) startCoding(key, { title: document.title, blocks: page.blocks, coverage, fingerprint: print });
    }
    // The job is the report run: CDI's card fills first, then the ICD-10 and CPT cards as each part lands.
    const r = await follow(key, (html, where) => {
      if (here()) show(html, where, false);
    });
    if (!r || !here()) return; // Left the report: the job saved its own codes for when the provider is back.
    fp = r.fingerprint;
    present(fromCoded(r));
    const q = pendingQuestion;
    pendingQuestion = null;
    if (q) void askByVoice(q);
  } catch (err) {
    if (here()) {
      show(card.messageCard("Medical coding", `I couldn't code this report. ${String(err instanceof Error ? err.message : err)}`), "cdi");
      for (const id of ["icd", "cpt"] as const) dock.removeCard(id);
    }
  }
}

const fromCoded = ({ fingerprint: _, ...r }: CodedReport): Report => ({ ...r, suggestions: [], sections: [], votes: {}, fixes: {}, checked: false });

// ── Voice questions (voiceQuestion.ts) ─────────────────────────────────────
export const askByVoice = (question: string, looksClinical = false): Promise<void> =>
  answerByVoice(question, looksClinical, { report: () => report, show, hold: (q) => (pendingQuestion = q), persist });

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
  leaveReport();
  view.unmount();
  dock.unmountDock();
}

/** The provider left the report (a single-page app changed its address): its highlights and cards go with it. */
export function leaveReport(): void {
  clearAnnotations();
  for (const id of ["cdi", "icd", "cpt", "review", "answer"] as const) dock.removeCard(id);
  report = pendingQuestion = viewing = viewingDx = marked = null;
}

/** Dictation's fill tag is the cursor while fill mode is armed; the companion waits. */
export function companionPause(pause: boolean): void {
  paused = pause;
  view.setVisible(!pause);
}

export const isOn = () => on;
