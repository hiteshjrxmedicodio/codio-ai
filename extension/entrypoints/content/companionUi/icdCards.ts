/**
 * Cards for the ICD pipeline: each phrase the report states a diagnosis in, with its ICD-10-CM
 * code beside it, and one diagnosis opened up with the trail the engine took to its code.
 */
import { STOP_BUTTON, esc, head } from "./cards";

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

/** One diagnosis while coding runs; diagnoses are worked on side by side, each with its own state. */
export interface IcdItem {
  phrase: string;
  state: "reading" | "read" | "coding" | "done" | "skipped" | "failed";
  code?: string | null;
  note?: string;
}

export interface IcdStep {
  /** cdi: the report run's first step; it shows in the CDI card, not here. */
  step: "cdi" | "extract" | "params" | "codes" | "done";
  label: string;
  done?: number;
  total?: number;
  items?: IcdItem[];
}

const STAGES: { key: IcdStep["step"]; label: string }[] = [
  { key: "extract", label: "Finding the diagnoses" },
  { key: "params", label: "Reading coding details" },
  { key: "codes", label: "Choosing the codes" },
];

const SKIPPED: Record<string, string> = { historical: "History only", uncertain: "Uncertain", ruled_out: "Ruled out" };

/** Codes already shown on the progress card, so only a code that has just landed pops in. */
let shown = new Set<string>();

/** What sits at the right of a diagnosis row: a shimmering placeholder while it runs, its code once it lands. */
function slot(x: IcdItem, i: number): string {
  if (x.state === "done") {
    const key = `${i}:${x.code ?? ""}`;
    const pop = shown.has(key) ? "" : " pop";
    shown.add(key);
    return x.code ? `<span class="chip${pop}">${esc(x.code)}</span>` : `<span class="chip none${pop}">Review</span>`;
  }
  if (x.state === "skipped") return `<span class="tag">${esc(SKIPPED[x.note ?? ""] ?? "Not coded")}</span>`;
  if (x.state === "failed") return `<span class="tag bad">Couldn't code</span>`;
  return `<span class="sk">${x.state === "coding" ? "Coding" : x.state === "read" ? "Ready" : "Reading"}</span>`;
}

/**
 * Coding while it runs. A three-part bar says which stage it is in; under it every diagnosis has its own
 * row, all running at once, and each code pops into its row the moment it lands.
 */
export function icdProgressCard(s: IcdStep): string {
  if (s.step === "extract") shown = new Set();
  // CDI ran before these steps in its own card; here the bar covers the three ICD stages only.
  const at = s.step === "done" ? STAGES.length : STAGES.findIndex((x) => x.key === s.step);
  const bar = STAGES.map((_, i) => `<span class="seg${i < at ? " done" : i === at ? " now" : ""}"></span>`).join("");
  const items = s.items ?? [];
  const active = items.filter((x) => x.state !== "skipped");
  const landed = active.filter((x) => x.state === "done" || x.state === "failed").length;
  const title =
    s.step === "extract" ? "Finding the diagnoses…"
    : s.step === "params" ? `Reading details for ${active.length} diagnos${active.length === 1 ? "is" : "es"} at once`
    : `Coding ${active.length} diagnos${active.length === 1 ? "is" : "es"} in parallel`;
  const read = active.filter((x) => x.state !== "reading").length;
  const sub =
    s.step === "codes" ? `${landed} of ${active.length} coded`
    : s.step === "params" ? `${read} of ${active.length} read`
    : "Reading the report";
  const rows = items.length
    ? items.map((x, i) => `<div class="lr ${x.state}"><span class="ind"></span><span class="ph" title="${esc(x.phrase)}">${esc(x.phrase)}</span>${slot(x, i)}</div>`).join("")
    : `<div class="lr ghost"><span class="ind"></span><span class="sk wide"></span></div>`.repeat(3);
  return `${head("ICD-10 codes")}<div class="body"><div class="prog"><div class="bar">${bar}</div>
    <div class="pt">${esc(title)}</div><div class="ps">${esc(sub)}</div></div><div class="live">${rows}</div>
    <div class="actions" style="margin-top:8px;display:flex;justify-content:flex-end">${STOP_BUTTON}</div></div>`;
}

const STATUS: Record<string, string> = { historical: "History only", uncertain: "Uncertain", ruled_out: "Ruled out" };

/**
 * Phrases that landed on the same code are one diagnosis to the provider: each phrase points at the
 * first phrase with that code, which is how the phrases sharing a card and trail are found.
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
 * The card for the phrase the provider clicked, when other phrases share its code: titled with that phrase,
 * its quotes first, the coding details any of them documented, and one trail for the whole group (the
 * same trail whichever phrase is clicked), from a phrase the engine coded itself if there is one.
 */
export function mergeSameCode(list: CodedDiagnosis[], clicked: number): CodedDiagnosis & { alsoAs: string[] } {
  const lead = sameCodeLeaders(list);
  const main = list[clicked] as CodedDiagnosis;
  const group = [main, ...list.filter((_, i) => i !== clicked && lead[i] === lead[clicked])];
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

/**
 * Every diagnosis with its code: the coded ones first, each with its code's description under the phrase,
 * then the ones not coded, dimmed, with why. Clicking a row opens how its code was reached.
 */
export function icdListCard(list: CodedDiagnosis[], engineError?: string): string {
  if (!list.length) return `${head("ICD-10 codes")}<div class="body"><div class="muted">I didn't find any diagnoses in this report.</div></div>`;
  const row = (d: CodedDiagnosis, i: number) => `<button class="dx${d.code ? "" : " off"}" data-action="dx" data-index="${i}" title="Show how this code was reached">
        <span class="ph"><span>${esc(d.phrase)}</span>${d.code && d.description ? `<small>${esc(d.description)}</small>` : !d.code && d.status === "current" && d.reviewReason ? `<small>${esc(d.reviewReason)}</small>` : ""}</span>${codeChip(d)}</button>`;
  const indexed = list.map((d, i) => ({ d, i }));
  const coded = indexed.filter((x) => x.d.code);
  const rest = indexed.filter((x) => !x.d.code);
  const sum = `<div class="sum"><span><b>${coded.length}</b> coded</span>${rest.length ? `<span><b>${rest.length}</b> not coded</span>` : ""}</div>`;
  const note = engineError ? `<div class="muted">Codes are unavailable right now: ${esc(engineError)}</div>` : "";
  return `${head("ICD-10 codes")}<div class="body">${sum}${coded.map((x) => row(x.d, x.i)).join("")}
    ${rest.length ? `<div class="group">Not coded</div>${rest.map((x) => row(x.d, x.i)).join("")}` : ""}${note}
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
