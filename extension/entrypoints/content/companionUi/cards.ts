/** HTML for the shapes the companion can take. Buttons carry data-action; the controller handles clicks. */
export interface Code {
  code: string;
  description: string;
  confidence: number;
  reason: string;
}

export interface Suggestion {
  id: string;
  block: string;
  title: string;
  kind: string;
  gate: { answer: string };
  quotes: { section: string; text: string }[];
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** Card header. In the docked card, the header bar (with its chevron) collapses and opens the card. */
export const head = (title: string) =>
  `<div class="head" title="Collapse or open"><span class="dot"></span><span>${esc(title)}</span><span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span><button class="x" data-action="close" aria-label="Close">×</button></div>`;

export const IMPACT: Record<string, string> = { coding: "Affects coding", denial: "Could cause a denial", interpretation: "Could be misread" };

export function loadingCard(title: string, text: string): string {
  return `${head(title)}<div class="body"><div class="muted" style="display:flex;gap:8px;align-items:center"><span class="spin"></span>${esc(text)}</div></div>`;
}

export function messageCard(title: string, text: string): string {
  return `${head(title)}<div class="body"><div class="muted">${esc(text)}</div></div>`;
}

function codeRows(label: string, codes: Code[]): string {
  if (!codes.length) return "";
  return `<div class="group">${label}</div>${codes
    .map((c) => `<div class="row"><span class="code">${esc(c.code)}</span><span class="desc">${esc(c.description)}</span></div>`)
    .join("")}`;
}

/** Only what the provider needs: each code and its name. */
export function codesCard(kind: string, icd: Code[], cpt: Code[]): string {
  const title = `Codio AI · ${kind === "both" ? "Diagnosis and procedure" : kind === "diagnosis" ? "Diagnosis" : "Procedure"}`;
  return `${head(title)}<div class="body">${codeRows("ICD-10-CM", icd)}${codeRows("CPT", cpt)}</div>`;
}

/** Asks before reading: what the review gives the provider, and what happens to identifiers (redacted in the service before any model sees the text). */
export const PREDICTION_TITLE: Record<"icd" | "cpt" | "final", string> = { icd: "ICD-10 prediction", cpt: "CPT pipeline", final: "Final codes" };

/** One prediction card: the codes and their names, with the count in the header. */
export function predictionCard(id: "icd" | "cpt" | "final", list: Code[]): string {
  const title = `${PREDICTION_TITLE[id]} · ${list.length} code${list.length === 1 ? "" : "s"}`;
  const body = list.length ? codeRows(id === "cpt" ? "CPT" : id === "icd" ? "ICD-10-CM" : "Codes", list) : `<div class="muted">No codes predicted.</div>`;
  return `${head(title)}<div class="body">${body}</div>`;
}

export function permissionCard(): string {
  return `${head("Codio AI")}<div class="body">
    <div><b style="font-size:13.5px">Code this report?</b><div class="muted">I'll read it end to end, clean it (CDI), then code its diagnoses (ICD-10) and procedures (CPT). Names and IDs are removed before anything is analysed.</div></div>
    <div class="actions"><button class="btn primary" data-action="allow">Code it</button><button class="btn ghost" data-action="deny">Not now</button></div></div>`;
}

export type Vote = "up" | "down";
/** A thumbs up's "what to change": written, being written, or failed. */
export type Fix = { guidance: string; choices: string[] } | "loading" | "error";

const THUMB_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4V10zM7 10l4-7a2 2 0 0 1 3 2l-1 5h5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 16.6 21H7"/></svg>`;
const THUMB_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h3v11zM17 14l-4 7a2 2 0 0 1-3-2l1-5H6a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 7.4 3H17"/></svg>`;

/** Thumbs for one suggestion. Up writes what to change; down drops it from this note. */
function thumbs(index: number, vote: Vote | undefined): string {
  return `<span class="votes"><button class="vote${vote === "up" ? " on" : ""}" data-action="up" data-index="${index}" aria-pressed="${vote === "up"}" aria-label="Useful, show what to change" title="Useful, show what to change">${THUMB_UP}</button><button class="vote" data-action="down" data-index="${index}" aria-label="Not useful" title="Not useful">${THUMB_DOWN}</button></span>`;
}

export function suggestionsCard(list: Suggestion[], votes: Record<number, Vote> = {}): string {
  const open = list.filter((_, i) => votes[i] !== "down").length;
  if (!open) {
    const text = list.length ? "You've dismissed every suggestion on this report." : "I read the whole report. Nothing critical stood out.";
    return `${head("Review · nothing critical")}<div class="body"><div class="muted">${text}</div></div>`;
  }
  const items = list
    .map((s, i) =>
      votes[i] === "down"
        ? `<div class="sug gone"><span>Dismissed. I won't raise this again on this note.</span></div>`
        : `<div class="sug"><button class="sug-main" data-action="goto" data-index="${i}">
        <b>${esc(s.title)}</b><span>${esc(IMPACT[s.gate.answer] ?? "Worth a look")}</span></button>${thumbs(i, votes[i])}</div>`,
    )
    .join("");
  return `${head(`Review · ${open} suggestion${open === 1 ? "" : "s"}`)}<div class="body">${items}</div>`;
}

function fixBlock(fix: Fix | undefined): string {
  if (!fix) return "";
  if (fix === "loading") return `<div class="muted" style="display:flex;gap:8px;align-items:center"><span class="spin"></span>Writing what to change…</div>`;
  if (fix === "error") return `<div class="muted">I couldn't write what to change right now. Try the thumbs up again.</div>`;
  return `<div class="fix"><div>${esc(fix.guidance)}</div><ul>${fix.choices.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
}

export function suggestionCard(s: Suggestion, index: number, vote?: Vote, fix?: Fix): string {
  const quotes = s.quotes.map((q) => `<div class="muted quote" title="${esc(q.text)}">“${esc(q.text)}”</div>`).join("");
  const rate = vote === "down"
    ? `<div class="muted">Dismissed. I won't raise this again on this note.</div>`
    : `<div class="rate"><span class="muted">${typeof fix === "object" ? "Helpful?" : "Useful?"}</span>${thumbs(index, vote)}</div>`;
  return `${head("Review · Suggestion")}<div class="body"><div class="group">${esc(IMPACT[s.gate.answer] ?? "Worth a look")}</div>
    <b style="font-size:13.5px">${esc(s.title)}</b>${quotes}${fixBlock(fix)}${rate}
    <div class="actions"><button class="btn ghost" data-action="back">All suggestions</button></div></div>`;
}

export function answerCard(question: string, answer: string): string {
  return `${head("Your question")}<div class="body"><div class="q">${esc(question)}</div><div style="font-size:13px;white-space:pre-wrap">${esc(answer)}</div></div>`;
}
