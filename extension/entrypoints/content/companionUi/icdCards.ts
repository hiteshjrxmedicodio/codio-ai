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

export interface IcdStep {
  step: "cdi" | "extract" | "params" | "codes" | "done";
  /** The report run cleans the report (CDI) before the ICD steps. */
  withCdi?: boolean;
  label: string;
  done?: number;
  total?: number;
  found?: string[];
  coded?: { phrase: string; code: string | null }[];
}

const STEPS: { key: IcdStep["step"]; label: string }[] = [
  { key: "cdi", label: "Cleaning the report (CDI)" },
  { key: "extract", label: "Finding the diagnoses" },
  { key: "params", label: "Reading coding details" },
  { key: "codes", label: "Choosing the ICD-10 codes" },
];

const MAX_ROWS = 4;
const more = (n: number) => (n > MAX_ROWS ? `<div class="res more">and ${n - MAX_ROWS} more</div>` : "");

/** What a step has produced so far, shown under it: the diagnoses found, then each code as it lands. */
function stepResult(key: IcdStep["step"], s: IcdStep): string {
  if (key === "extract" && s.found?.length) {
    return s.found.slice(0, MAX_ROWS).map((p) => `<div class="res">${esc(p)}</div>`).join("") + more(s.found.length);
  }
  if (key === "codes" && s.coded?.length) {
    return s.coded.slice(-MAX_ROWS).map((c) => `<div class="res"><span>${esc(c.phrase)}</span>${c.code ? `<span class="chip">${esc(c.code)}</span>` : `<span class="chip none">Review</span>`}</div>`).join("");
  }
  return "";
}

/** The three coding steps while they run: finished ones ticked with what they found, the current one spinning with its count. */
export function icdProgressCard(s: IcdStep): string {
  const steps = STEPS.filter((x) => x.key !== "cdi" || s.withCdi);
  const at = steps.findIndex((x) => x.key === s.step);
  const rows = steps.map((x, i) => {
    const state = s.step === "done" || i < at ? "done" : i === at ? "now" : "next";
    const mark = state === "done" ? `<span class="tick">✓</span>` : state === "now" ? `<span class="spin"></span>` : `<span class="dot"></span>`;
    const label = x.key === "extract" && state === "done" && s.found ? `Found ${s.found.length} diagnos${s.found.length === 1 ? "is" : "es"}` : x.label;
    const count = state === "now" && s.total ? ` <span class="conf">${s.done ?? 0} of ${s.total}</span>` : "";
    return `<li class="${state}"><div class="lab">${mark}<span>${esc(label)}${count}</span></div>${stepResult(x.key, s)}</li>`;
  }).join("");
  return `${head("ICD-10 codes")}<div class="body"><ol class="steps">${rows}</ol></div>`;
}

const STATUS: Record<string, string> = { historical: "History only", uncertain: "Uncertain", ruled_out: "Ruled out" };

/**
 * Phrases that landed on the same code are one diagnosis to the provider: each phrase points at the
 * first phrase with that code, and that first phrase opens the shared card and trail.
 */
export function sameCodeLeaders(list: CodedDiagnosis[]): number[] {
  const first = new Map<string, number>();
  return list.map((d, i) => {
    if (!d.code) return i;
    if (!first.has(d.code)) first.set(d.code, i);
    return first.get(d.code) ?? i;
  });
}

/**
 * The card for a code stated by several phrases: every phrase's quotes, the coding details any of them
 * documented, and one trail, from a phrase the engine coded itself if there is one (not the second opinion).
 */
export function mergeSameCode(list: CodedDiagnosis[], leader: number): CodedDiagnosis & { alsoAs: string[] } {
  const lead = sameCodeLeaders(list);
  const group = list.filter((_, i) => lead[i] === leader);
  const main = list[leader] as CodedDiagnosis;
  const withTrail = group.filter((d) => d.trail);
  const trail = (withTrail.find((d) => !d.trail?.fallback) ?? withTrail[0])?.trail ?? main.trail;
  const documented = new Map<string, { name: string; value: string }>();
  for (const d of group) for (const p of d.params?.documented ?? []) if (!documented.has(p.name)) documented.set(p.name, p);
  const missing = [...new Set(group.flatMap((d) => d.params?.missing ?? []))].filter((m) => !documented.has(m));
  const params = group.some((d) => d.params) ? { documented: [...documented.values()], missing } : null;
  const alsoAs = [...new Set(group.slice(1).map((d) => d.phrase))].filter((p) => p !== main.phrase);
  return { ...main, quotes: group.flatMap((d) => d.quotes), params, trail, alsoAs };
}

/** The code beside a phrase, or why there is none. */
function codeChip(d: CodedDiagnosis): string {
  if (d.code) return `<span class="chip">${esc(d.code)}</span>`;
  return `<span class="chip none">${esc(STATUS[d.status] ?? "Review")}</span>`;
}

export function icdListCard(list: CodedDiagnosis[], engineError?: string): string {
  if (!list.length) return `${head("ICD-10 codes")}<div class="body"><div class="muted">I didn't find any diagnoses in this report.</div></div>`;
  const coded = list.filter((d) => d.code).length;
  const lead = sameCodeLeaders(list);
  const items = list
    .map(
      (d, i) => `<button class="dx" data-action="dx" data-index="${lead[i]}" title="Show how this code was reached">
        <span class="ph">${esc(d.phrase)}</span>${codeChip(d)}</button>`,
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

/** Quotes without repeats: a quote already contained in a longer one is dropped. */
function distinctQuotes(quotes: { text: string }[]): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
  const texts = [...new Set(quotes.map((q) => q.text.trim()))].sort((x, y) => y.length - x.length);
  const kept: string[] = [];
  for (const t of texts) if (!kept.some((k) => norm(k).includes(norm(t)))) kept.push(t);
  return kept;
}

const section = (title: string, body: string) =>
  `<section class="sec"><div class="sh">${esc(title)}</div><div class="sb">${body}</div></section>`;

/** The engine's walk: its key milestones up front, every step behind "Show all steps". */
function routeBody(d: CodedDiagnosis): string {
  const t = d.trail;
  if (!t) return `<div class="muted">${d.status === "current" ? "Not sent to the engine." : `Not sent for coding: ${esc((STATUS[d.status] ?? d.status).toLowerCase())}.`}</div>`;
  const li: string[] = [];
  if (t.start.length) li.push(`<li><span class="what">Looked up the ICD-10 index</span>${t.start.map((h) => `<span class="sub">“${esc(h.term)}” → ${node(h.code, null)}</span>`).join("")}</li>`);
  li.push(...t.steps.map(stepLine));
  const end = d.code
    ? `<li class="end"><span class="what">Code: ${node(d.code, d.description)}</span>${t.fallback ? `<span class="sub">Proposed by the second opinion; worth a check.</span>` : ""}</li>`
    : `<li class="stop"><span class="what">Not coded</span><span class="sub">${esc(d.reviewReason ?? "Needs review")}${d.candidates?.length ? ` · closest: ${esc(d.candidates.slice(0, 4).join(", "))}` : ""}</span></li>`;
  const category = t.steps.find((x) => x.kind === "choice" && x.level === "category");
  const key = [li[0], category ? stepLine(category) : "", end].filter(Boolean).join("");
  return `<ol class="trail">${key}</ol><details class="all"><summary>Show all ${li.length + 1} steps</summary><ol class="trail">${li.join("")}${end}</ol></details>`;
}

export function icdDetailCard(d: CodedDiagnosis & { alsoAs?: string[] }): string {
  const result = d.code
    ? `<div class="row"><span class="code">${esc(d.code)}</span><span class="desc">${esc(d.description ?? "")}</span></div>`
    : `<div class="row"><span class="muted" style="grid-column:1/-1">${esc(d.reviewReason ?? "Needs review")}</span></div>`;
  const quotes = distinctQuotes(d.quotes);
  const found = quotes.length
    ? quotes.slice(0, 2).map((q) => `<div class="muted quote" title="${esc(q)}">“${esc(q)}”</div>`).join("") + (quotes.length > 2 ? `<div class="muted">and ${quotes.length - 2} more on the chart</div>` : "")
    : `<div class="muted">No exact wording found.</div>`;
  const documented = d.params?.documented ?? [];
  const kv = documented.length ? `<dl class="kv">${documented.map((p) => `<dt>${esc(p.name)}</dt><dd>${esc(p.value)}</dd>`).join("")}</dl>` : "";
  const missing = d.params?.missing.length ? `<div class="gap"><span class="gl">Not documented</span>${d.params.missing.map((m) => `<span class="tag">${esc(m)}</span>`).join("")}</div>` : "";
  const details = kv || missing ? kv + missing : `<div class="muted">No coding details were read.</div>`;
  const also = d.alsoAs?.length ? `<div class="muted">Also stated as ${d.alsoAs.map((p) => `“${esc(p)}”`).join(", ")}, same code and trail</div>` : "";
  return `${head("ICD-10 · Diagnosis")}<div class="body"><b style="font-size:13.5px">${esc(d.phrase)}</b>${also}${result}
    <div class="flow">${section("Found in the report", found)}${section("Coding details", details)}${section("How the code was chosen", routeBody(d))}</div>
    <div class="actions"><button class="btn ghost" data-action="icd-back">All diagnoses</button></div></div>`;
}
