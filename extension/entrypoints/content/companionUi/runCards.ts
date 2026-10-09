/**
 * The report run's other two cards, beside ICD-10 codes: CDI (each section it cleaned, before and
 * after) and the CPT pipeline (each procedure and the journey to its code: extraction, search,
 * candidates, selection, final list).
 */
import { esc, head, loadingCard, messageCard } from "./cards";

export interface CdiChange {
  kind: string;
  before: string;
  after: string;
  reason: string;
}

export interface CdiSection {
  heading: string;
  original: string;
  cleaned: string;
  /** CDI's trail for this section: each change it made, and what it was unsure of and left as written. */
  changes: CdiChange[];
  flags: { text: string; reason: string }[];
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
export const cdiLoading = () => loadingCard("CDI", "Cleaning the report…");

export function cdiListCard(v: CdiView): string {
  if (v.error) return messageCard("CDI", `CDI couldn't run, so coding read the report as written. ${v.error}`);
  if (!v.sections.length) return `${head("CDI · nothing to clean")}<div class="body"><div class="muted">All ${v.total} sections were already clear; coding read them as written.</div></div>`;
  const rows = v.sections
    .map((s, i) => {
      const n = s.changes.length;
      const label = n ? `${n} change${n === 1 ? "" : "s"}` : "Checked";
      return `<button class="dx" data-action="cdi" data-index="${i}" title="Show what CDI changed"><span class="ph">${esc(s.heading || "(no heading)")}</span><span class="chip${n ? "" : " none"}">${label}</span></button>`;
    })
    .join("");
  const n = v.sections.reduce((t, s) => t + s.changes.length, 0);
  return `${head(`CDI · ${n} change${n === 1 ? "" : "s"} in ${v.sections.length} of ${v.total} sections`)}<div class="body">${rows}
    <div class="muted">Diagnoses and procedures were read from the cleaned text. Nothing on the page was changed.</div></div>`;
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

/** CDI's trail for one section: each change as before → after with its reason, in the order made. */
function changeTrail(s: CdiSection): string {
  if (!s.changes.length) return `<div class="muted">No changes; the text was already clear.</div>`;
  const items = s.changes.map((c) =>
    li(esc(KIND[c.kind] ?? c.kind), `${c.before ? `<s>${esc(c.before)}</s> → ` : ""}<b>${esc(c.after || "(removed)")}</b>${c.reason ? `<br>${esc(c.reason)}` : ""}`),
  );
  return `<ol class="trail">${items.join("")}</ol>`;
}

export function cdiDetailCard(s: CdiSection): string {
  const text = (t: string) => `<div class="muted" style="white-space:pre-wrap">${esc(t)}</div>`;
  const left = s.flags.length ? section("Left as written", `<ol class="trail">${s.flags.map((f) => li(esc(f.text), esc(f.reason), "stop")).join("")}</ol>`) : "";
  const full = `<details class="all"><summary>Show the whole section, before and after</summary>${section("As written", text(s.original))}${section("After CDI", text(s.cleaned))}</details>`;
  return `${head("CDI · Section")}<div class="body"><b style="font-size:13.5px">${esc(s.heading || "(no heading)")}</b>
    <div class="flow">${section("What CDI changed", changeTrail(s))}${left}${full}</div>
    <div class="actions"><button class="btn ghost" data-action="cdi-back">All sections</button></div></div>`;
}

// ── CPT pipeline ───────────────────────────────────────────────────────────
export const cptLoading = () => loadingCard("CPT pipeline", "Finding procedures and their codes…");

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
  const by = s.source === "decisions" ? "Decisions API" : "Gemini";
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
