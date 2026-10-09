/**
 * The report run's other two cards, beside ICD-10 codes: CDI (each section it cleaned, before and
 * after) and the CPT pipeline (each procedure and the journey to its code: extraction, search,
 * candidates, selection, final list).
 */
import { esc, head, loadingCard, messageCard } from "./cards";

/** Whether a change or an item left as written can change the predicted codes, and the readings it decides between. */
export interface CodingImpact {
  affects_coding?: boolean;
  coding_effect?: string;
}

export interface CdiChange extends CodingImpact {
  kind: string;
  before: string;
  after: string;
  reason: string;
}

export type CdiFlag = CodingImpact & { text: string; reason: string };

export interface CdiSection {
  heading: string;
  original: string;
  cleaned: string;
  /** CDI's trail for this section: each change it made, and what it was unsure of and left as written. */
  changes: CdiChange[];
  flags: CdiFlag[];
}

export interface CdiView {
  sections: CdiSection[];
  total: number;
  confidence: number;
  error?: string;
}

export interface CptProcedure {
  procedure_text: string;
  extracted_procedure: string;
  laterality: string;
  approach: string;
  quantity: string;
  attempted?: boolean;
  candidates: { code: string; descriptor: string; score: number }[];
  topScore: number;
  skipped?: string;
  selection?: { code: string; confidence: number; rationale: string; source: string };
  outcome?: "coded" | "merged" | "below_gate" | "not_chosen" | "skipped";
}

export interface CptView {
  /** Turned off in the service's config for this run: no CPT card. */
  off?: boolean;
  status: string;
  procedures: CptProcedure[];
  codes: { code: string; modifier: string; description: string; confidence: number; procedure: string }[];
  error?: string;
}

const pct = (c: number) => `<span class="conf">${Math.round(c * 100)}%</span>`;
const section = (title: string, body: string) => `<section class="sec"><div class="sh">${esc(title)}</div><div class="sb">${body}</div></section>`;
const li = (what: string, sub = "", cls = "") => `<li${cls ? ` class="${cls}"` : ""}><span class="what">${what}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</li>`;

// ── CDI ────────────────────────────────────────────────────────────────────
export const cdiLoading = () => loadingCard("CDI", "Cleaning the report…", true);

const usable = (h: string) => /[a-z0-9]/i.test(h);
/** The label a section's text opens with ("Assessment: ..."), for a section without a heading. */
const opening = (s: CdiSection) => s.original.trim().split("\n")[0]?.match(/^([^:]{2,60}):/)?.[1]?.trim() ?? "";
/** The section's first words, for a section with neither a heading nor an opening label. */
function firstWords(s: CdiSection): string {
  const words = s.original.replace(/\s+/g, " ").trim().split(" ").filter((w) => /[a-z0-9]/i.test(w));
  return words.length ? `${words.slice(0, 5).join(" ").replace(/[.,;:]+$/, "")}${words.length > 5 ? "…" : ""}` : "Untitled section";
}

/** A name the provider recognises: the heading, else the label the text opens with, else its first words. */
export const sectionName = (s: CdiSection) => (usable(s.heading) ? s.heading.trim() : opening(s) || firstWords(s));

/** Kinds that change what a coder reads, for records saved before CDI judged each item itself. */
const CODING_KINDS = new Set(["interpretation", "reference", "copy", "removal", "split"]);
const affectsCoding = (x: CodingImpact & { kind?: string }) => x.affects_coding ?? (x.kind ? CODING_KINDS.has(x.kind) : false);

/**
 * How much one item matters, for its colour on the chart and in the card: high when it can change the
 * codes, medium when it needs a check (left as written, or a connection CDI inferred), low when it is
 * a writing correction (spelling, an abbreviation, a format).
 */
export type Level = "high" | "medium" | "low";
export function criticality(x: CodingImpact & { kind?: string }, leftAsWritten = false): Level {
  if (affectsCoding(x)) return "high";
  return leftAsWritten || x.kind === "interpretation" ? "medium" : "low";
}

const LEGEND = `<div class="legend"><span><i class="lv-high"></i>Changes the codes</span><span><i class="lv-medium"></i>Needs a check</span><span><i class="lv-low"></i>Writing correction</span></div>`;

export interface CdiGroup {
  title: string;
  /** Each section with only this group's changes and items left as written. */
  sections: CdiSection[];
}

/**
 * Always two groups: what can change the predicted codes first (CDI judges each change, and each item it
 * left as written, and names the readings: MSSA as the cause of a cellulitis or as an infection of its
 * own), then general issues, the writing corrections that leave the codes as they are.
 */
export function cdiGroups(v: CdiView): CdiGroup[] {
  const part = (coding: boolean): CdiSection[] =>
    v.sections
      .map((s) => ({ ...s, changes: s.changes.filter((c) => affectsCoding(c) === coding), flags: s.flags.filter((f) => affectsCoding(f) === coding) }))
      .filter((s) => s.changes.length || s.flags.length);
  return [
    { title: "Issues that change the codes", sections: part(true) },
    { title: "General issues", sections: part(false) },
  ];
}

const count = (list: CdiSection[]) => list.reduce((t, s) => t + s.changes.length + s.flags.length, 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function cdiListCard(v: CdiView): string {
  if (v.error) return messageCard("CDI", `CDI couldn't run, so coding read the report as written. ${v.error}`);
  if (!v.sections.length) return `${head("CDI · nothing to clean")}<div class="body"><div class="muted">All ${v.total} sections were already clear; coding read them as written.</div></div>`;
  const rows = cdiGroups(v)
    .map((g, i) => {
      const n = count(g.sections);
      const label = n ? plural(n, "item") : "None";
      const sub = g.sections.length ? g.sections.map(sectionName).join(" · ") : i === 0 ? "Nothing CDI did changes the codes" : "No writing corrections";
      return `<button class="dx" data-action="cdi" data-index="${i}" title="Show what CDI changed"${g.sections.length ? "" : " disabled"}>
        <span class="ph"><span>${esc(g.title)}</span><small title="${esc(sub)}">${esc(sub)}</small></span>
        <span class="chip${n ? (i === 0 ? " warn" : "") : " none"}">${label}</span></button>`;
    })
    .join("");
  const n = v.sections.reduce((t, s) => t + s.changes.length, 0);
  return `${head(`CDI · ${plural(n, "change")} in ${v.sections.length} of ${v.total} sections`)}<div class="body">${rows}
    ${LEGEND}<div class="muted">Diagnoses and procedures were read from the cleaned text. Nothing on the page was changed; the coloured words on it are what CDI changed.</div></div>`;
}

const KIND: Record<string, string> = {
  abbreviation: "Expanded abbreviation",
  interpretation: "Interpreted reference (inferred, check it)",
  reference: "Resolved reference",
  spelling: "Corrected spelling",
  normalization: "Normalised",
  removal: "Removed",
  split: "Split onto separate lines",
  copy: "Copied into the assessment",
};

/** How the item can change the codes: the readings it decides between and the codes each gives. */
const effect = (x: CodingImpact) => (x.coding_effect ? `<span class="impact" style="display:block;margin-top:4px;padding:5px 7px;border-radius:6px;background:#fdf1e4;color:#7c2d12;font-size:12px"><b>Coding:</b> ${esc(x.coding_effect)}</span>` : "");

/** CDI's trail for one section: each change as before → after with its reason, in the order made. */
function changeTrail(s: CdiSection): string {
  if (!s.changes.length) return `<div class="muted">No changes; the text was already clear.</div>`;
  const items = s.changes.map((c) =>
    li(esc(KIND[c.kind] ?? c.kind), `${c.before ? `<s>${esc(c.before)}</s> → ` : ""}<b>${esc(c.after || "(removed)")}</b>${c.reason ? `<br>${esc(c.reason)}` : ""}${effect(c)}`, `lv-${criticality(c)}`),
  );
  return `<ol class="trail">${items.join("")}</ol>`;
}

const SEC_HEAD = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:4px;border-bottom:1px solid #e6ddcc";

/** One section inside a group: a header with its count, what CDI changed, what it left as written, and the whole text on request. */
function sectionBlock(s: CdiSection): string {
  const n = s.changes.length;
  const chip = `<span class="chip">${plural(n + s.flags.length, "item")}</span>`;
  const header = `<div style="${SEC_HEAD}"><b style="font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(sectionName(s))}">${esc(sectionName(s))}</b>${chip}</div>`;
  if (!n && !s.flags.length) return header;
  const text = (t: string) => `<div class="muted" style="white-space:pre-wrap">${esc(t)}</div>`;
  const left = s.flags.length ? section("Left as written", `<ol class="trail">${s.flags.map((f) => li(esc(f.text), `${esc(f.reason)}${effect(f)}`, `lv-${criticality(f, true)}`)).join("")}</ol>`) : "";
  const full = `<details class="all"><summary>Show the whole section, before and after</summary>${section("As written", text(s.original))}${section("After CDI", text(s.cleaned))}</details>`;
  return `${header}<div class="flow">${n ? changeTrail(s) : ""}${left}${full}</div>`;
}

/** One group (issues that change the codes, or general issues), section by section. */
export function cdiDetailCard(g: CdiGroup): string {
  const n = count(g.sections);
  return `${head(`CDI · ${g.title}`)}<div class="body"><div class="muted">${plural(n, "item")} in ${plural(g.sections.length, "section")}</div>${LEGEND}
    ${g.sections.map(sectionBlock).join("")}
    <div class="actions"><button class="btn ghost" data-action="cdi-back">Both groups</button></div></div>`;
}

// ── CPT pipeline ───────────────────────────────────────────────────────────
export const cptLoading = () => loadingCard("CPT pipeline", "Finding procedures and their codes…", true);

const OUTCOME: Record<NonNullable<CptProcedure["outcome"]>, string> = {
  coded: "",
  merged: "Same code as another procedure",
  below_gate: "Below confidence gate",
  not_chosen: "No code chosen",
  skipped: "Not coded",
};

function chip(p: CptProcedure, modifier: string): string {
  if (p.outcome === "coded" && p.selection) return `<span class="chip">${esc(p.selection.code + modifier)}</span>`;
  return `<span class="chip none">${esc(p.outcome === "merged" && p.selection ? p.selection.code : OUTCOME[p.outcome ?? "skipped"])}</span>`;
}

const modifierOf = (v: CptView, p: CptProcedure) => v.codes.find((c) => c.code === p.selection?.code)?.modifier ?? "";

export function cptListCard(v: CptView): string {
  if (v.error) return messageCard("CPT pipeline", `I couldn't code the procedures. ${v.error}`);
  if (!v.procedures.length) return `${head("CPT pipeline")}<div class="body"><div class="muted">No procedure was performed in this report.</div></div>`;
  const rows = v.procedures
    .map((p, i) => `<button class="dx" data-action="proc" data-index="${i}" title="Show how this code was reached"><span class="ph">${esc(p.procedure_text)}</span>${chip(p, modifierOf(v, p))}</button>`)
    .join("");
  const status = v.status === "mixed" ? "One procedure was discontinued; its code carries -53." : v.status === "attempted" ? "The procedure was discontinued; its code carries -53." : "";
  return `${head(`CPT pipeline · ${v.codes.length} code${v.codes.length === 1 ? "" : "s"}`)}<div class="body">${rows}
    ${status ? `<div class="muted">${status}</div>` : ""}<div class="muted">Click a procedure to see its journey to a code.</div></div>`;
}

/** The journey of one procedure: extraction → search → candidates → selection → final list. */
function journey(v: CptView, p: CptProcedure): string {
  const steps: string[] = [];
  const details = [p.approach && `approach ${p.approach}`, p.laterality !== "N/A" && p.laterality, p.quantity !== "single" && p.quantity].filter(Boolean).join(" · ");
  steps.push(li("Extracted from the report", `${esc(p.procedure_text)}${details ? ` · ${esc(details)}` : ""}${p.attempted ? " · discontinued" : ""}`));
  steps.push(li("Searched the CPT index", `“${esc(p.extracted_procedure || p.procedure_text)}” · best match ${pct(p.topScore)}`));
  if (p.skipped) return `<ol class="trail">${steps.join("")}${li("Not coded", esc(p.skipped), "stop")}</ol>`;
  // The first five, plus the chosen one when it ranked lower, so the pick is always shown in its place.
  const shown = p.candidates.filter((c, i) => i < 5 || c.code === p.selection?.code);
  const top = shown.map((c) => `<span class="sub">${c.code === p.selection?.code ? "<b>" : ""}${esc(c.code)}${c.code === p.selection?.code ? "</b>" : ""} ${esc(c.descriptor.split(" | ")[0] ?? "")} ${pct(c.score)}</span>`);
  steps.push(`<li><span class="what">Compared ${p.candidates.length} candidate codes</span>${top.join("")}</li>`);
  const s = p.selection;
  if (!s) return `<ol class="trail">${steps.join("")}${li("No code chosen", "", "stop")}</ol>`;
  const by = s.source === "decisions" ? "Decisions API" : s.source;
  steps.push(li(`Chose <b>${esc(s.code)}</b> ${pct(s.confidence)}`, `${esc(s.rationale || "No reason given")} · ${by}`));
  const mod = modifierOf(v, p);
  const end =
    p.outcome === "coded"
      ? li(`Final code: <b>${esc(s.code + mod)}</b>`, mod ? "Modifier for a discontinued procedure" : "", "end")
      : p.outcome === "merged"
        ? li("Not listed again", `${esc(s.code)} is already billed for another procedure`, "stop")
        : li("Dropped", `Confidence ${Math.round(s.confidence * 100)}% is below the gate`, "stop");
  return `<ol class="trail">${steps.join("")}${end}</ol>`;
}

export function cptDetailCard(v: CptView, i: number): string {
  const p = v.procedures[i];
  if (!p) return cptListCard(v);
  return `${head("CPT pipeline · Procedure")}<div class="body"><b style="font-size:13.5px">${esc(p.procedure_text)}</b>
    <div class="flow">${section("How the code was reached", journey(v, p))}</div>
    <div class="actions"><button class="btn ghost" data-action="cpt-back">All procedures</button></div></div>`;
}
