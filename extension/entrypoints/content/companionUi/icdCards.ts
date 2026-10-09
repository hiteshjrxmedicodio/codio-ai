/**
 * Cards for the ICD pipeline: each phrase the report states a diagnosis in, with its ICD-10-CM
 * code beside it, and one diagnosis opened up with the trail the engine took to its code.
 */
import { esc, head } from "./cards";

type TrailStep =
  | { kind: "choice"; level: string; parent: string | null; parent_desc: string | null; chose: string | null; chose_desc: string | null; confidence: number | null; undecided: boolean }
  | { kind: "linked"; reached: string[]; dead: string[] }
  | { kind: "candidates"; codes: string[] }
  | { kind: "decide"; chose: string | null; chose_desc: string | null; confidence: number | null }
  | { kind: "verify"; code: string | null; result: string | null }
  | { kind: "gemini"; chose: string | null; chose_desc: string | null };

export interface CodedDiagnosis {
  phrase: string;
  status: string;
  quotes: { section: string; text: string }[];
  params: { documented: { name: string; value: string }[]; missing: string[] } | null;
  code: string | null;
  description: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  candidates?: string[];
  trail?: { start: { code: string; term: string; desc: string | null }[]; steps: TrailStep[]; fallback: boolean } | null;
}

const STATUS: Record<string, string> = { historical: "History only", uncertain: "Uncertain", ruled_out: "Ruled out" };

/** The code beside a phrase, or why there is none. */
function codeChip(d: CodedDiagnosis): string {
  if (d.code) return `<span class="chip">${esc(d.code)}</span>`;
  return `<span class="chip none">${esc(STATUS[d.status] ?? "Review")}</span>`;
}

export function icdListCard(list: CodedDiagnosis[], engineError?: string): string {
  if (!list.length) return `${head("ICD-10 codes")}<div class="body"><div class="muted">I didn't find any diagnoses in this report.</div></div>`;
  const coded = list.filter((d) => d.code).length;
  const items = list
    .map(
      (d, i) => `<button class="dx" data-action="dx" data-index="${i}" title="Show how this code was reached">
        <span class="n">${i + 1}</span><span class="ph">${esc(d.phrase)}</span>${codeChip(d)}</button>`,
    )
    .join("");
  const note = engineError ? `<div class="muted">Codes are unavailable right now: ${esc(engineError)}</div>` : "";
  return `${head(`ICD-10 codes · ${coded} of ${list.length} coded`)}<div class="body">${items}${note}
    <div class="muted">Click a phrase here or on the chart to see how its code was reached.</div>
    <div class="actions"><button class="btn ghost" data-action="check">Check documentation</button></div></div>`;
}

const pct = (c: number | null) => (typeof c === "number" ? ` <span class="conf">${Math.round(c * 100)}%</span>` : "");
const node = (code: string | null, desc: string | null) => (code ? `<b>${esc(code)}</b>${desc ? ` ${esc(desc)}` : ""}` : "");

const list = (codes: string[], max: number) => esc(codes.slice(0, max).join(", ") + (codes.length > max ? ` and ${codes.length - max} more` : ""));

/** One step of the engine's walk as a line of the trail. */
function stepLine(s: TrailStep): string {
  const li = (what: string, sub = "", cls = "") => `<li${cls ? ` class="${cls}"` : ""}><span class="what">${what}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</li>`;
  switch (s.kind) {
    case "choice":
      if (s.undecided) return li(`Couldn't choose under ${node(s.parent, s.parent_desc)}`, "", "stop");
      if (s.level === "system") return li("Chose the chapter", `${node(s.chose, s.chose_desc)}${pct(s.confidence)}`);
      if (s.level === "category") return li("Chose the category", `${node(s.chose, s.chose_desc)}${pct(s.confidence)}`);
      return li(s.parent ? `Under ${node(s.parent, null)}, chose` : "Chose", `${node(s.chose, s.chose_desc)}${pct(s.confidence)}`);
    case "linked": {
      const n = s.reached.length + s.dead.length;
      const parts = [s.reached.length ? `possible: ${list(s.reached, 6)}` : "", s.dead.length ? `no fit in ${list(s.dead, 6)}` : ""].filter(Boolean);
      return li(`Also checked ${n} linked categor${n === 1 ? "y" : "ies"} (Excludes and see-also notes)`, parts.join("; "));
    }
    case "candidates":
      return li(`Compared ${s.codes.length} candidate code${s.codes.length === 1 ? "" : "s"}`, list(s.codes, 8));
    case "decide":
      return s.chose ? li("Picked", `${node(s.chose, s.chose_desc)}${pct(s.confidence)}`) : li("Couldn't pick one", "", "stop");
    case "verify":
      return li(`Checked ${node(s.code, null)} against the chart`, s.result === "supported" ? "Supported by the documentation" : esc(s.result ?? "Not supported"), s.result === "supported" ? "" : "stop");
    case "gemini":
      return li("Second opinion (Gemini)", s.chose ? node(s.chose, s.chose_desc) : "");
  }
}

/** The engine's steps, top to bottom, ending in the code or the reason it stopped. */
function trailBlock(d: CodedDiagnosis): string {
  const t = d.trail;
  if (!t) return d.status === "current" ? "" : `<div class="muted">Not sent for coding: ${esc((STATUS[d.status] ?? d.status).toLowerCase())}.</div>`;
  const li: string[] = [];
  if (t.start.length) {
    li.push(`<li><span class="what">Looked up the ICD-10 index</span>${t.start.map((h) => `<span class="sub">“${esc(h.term)}” → ${node(h.code, null)}</span>`).join("")}</li>`);
  }
  li.push(...t.steps.map(stepLine));
  li.push(
    d.code
      ? `<li class="end"><span class="what">Code: ${node(d.code, d.description)}</span>${t.fallback ? `<span class="sub">Proposed by the second opinion; worth a check.</span>` : ""}</li>`
      : `<li class="stop"><span class="what">Not coded</span><span class="sub">${esc(d.reviewReason ?? "Needs review")}${d.candidates?.length ? ` · closest: ${esc(d.candidates.slice(0, 4).join(", "))}` : ""}</span></li>`,
  );
  return `<div class="group">Prediction trail</div><ol class="trail">${li.join("")}</ol>`;
}

export function icdDetailCard(d: CodedDiagnosis, index: number): string {
  const quotes = d.quotes.map((q) => `<div class="muted quote" title="${esc(q.text)}">“${esc(q.text)}”</div>`).join("");
  const params = (d.params?.documented ?? []).map((p) => `<div class="muted"><b style="color:#24211c">${esc(p.name)}:</b> ${esc(p.value)}</div>`).join("");
  const missing = d.params?.missing.length ? `<div class="muted">Not documented: ${esc(d.params.missing.join("; "))}</div>` : "";
  const code = d.code
    ? `<div class="row"><span class="code">${esc(d.code)}</span><span class="desc">${esc(d.description ?? "")}</span></div>`
    : `<div class="row"><span class="muted" style="grid-column:1/-1">${esc(d.reviewReason ?? "Needs review")}</span></div>`;
  return `${head(`ICD-10 · Diagnosis ${index + 1}`)}<div class="body"><b style="font-size:13.5px">${esc(d.phrase)}</b>${code}${quotes}
    ${params}${missing}${trailBlock(d)}
    <div class="actions"><button class="btn ghost" data-action="icd-back">All diagnoses</button></div></div>`;
}
