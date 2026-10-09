import { getConfig } from "../../core/config";
import { mapLimit } from "../../core/limit";
import { redactBlocks } from "../../core/privacy/redact";
import type { Usage } from "../../core/types";
import { reportText, type Block } from "../icd/extract";
import { extractProcedures, proceduresToCode, type Extraction, type ProcStatus, type Procedure } from "./extract";
import type { Candidate } from "./rerank";
import { retrieveCandidates } from "./retrieve";
import { selectCodes, type ToCode } from "./select";

export interface CptCode {
  code: string;
  /** The discontinued-procedure modifier, or empty. */
  modifier: string;
  description: string;
  confidence: number;
  reason: string;
  procedure: string;
}

export interface CodedProcedure extends Procedure {
  candidates: Candidate[];
  topScore: number;
  /** Why the procedure was not sent to selection. */
  skipped?: string;
  /** What selection chose for it, before dedup and the gate. */
  selection?: { code: string; confidence: number; rationale: string; source: string };
  /** Where its journey ended, for the provider's trail. */
  outcome?: "coded" | "merged" | "below_gate" | "not_chosen" | "skipped";
}

/** Each procedure's last step: its code made the final list, lost to the same code elsewhere, fell under the gate, or never got a code. */
function outcomeOf(p: CodedProcedure, final: CptCode[], gate: number): CodedProcedure["outcome"] {
  if (p.skipped) return "skipped";
  const sel = p.selection;
  if (!sel) return "not_chosen";
  const kept = final.find((c) => c.code === sel.code);
  if (kept) return kept.procedure === p.procedure_text ? "coded" : "merged";
  // A discontinued procedure's code is never gated, so it is always in the final list.
  return sel.confidence < gate ? "below_gate" : "merged";
}

export interface CptResult {
  status: ProcStatus;
  extraction: Extraction;
  procedures: CodedProcedure[];
  codes: CptCode[];
  usage: Usage[];
}

/**
 * One line per code: a code with a modifier beats the same code without one, otherwise the higher
 * confidence wins. Then the confidence gate; the discontinued-procedure modifier is exempt.
 */
export function finalize(codes: CptCode[], gate: number, attemptedModifier: string): CptCode[] {
  const best = new Map<string, CptCode>();
  for (const c of codes) {
    if (!c.code) continue;
    const prev = best.get(c.code);
    if (!prev || (c.modifier && !prev.modifier) || (!c.modifier === !prev.modifier && c.confidence > prev.confidence)) best.set(c.code, c);
  }
  return [...best.values()].filter((c) => c.modifier === attemptedModifier || c.confidence >= gate);
}

/**
 * Report → completion status and procedures → CPT candidates per procedure from Pinecone →
 * one code per procedure → dedup and confidence gate. A procedure whose retrieval fails or
 * scores below the threshold is listed with the reason, not coded.
 */
export async function predictCpt(raw: Block[]): Promise<CptResult> {
  const cfg = getConfig().cpt_pipeline;
  const blocks = redactBlocks(raw);
  const usage: Usage[] = [];

  const { extraction, usage: u1 } = await extractProcedures(blocks);
  usage.push(u1);
  const procs = proceduresToCode(extraction);
  const status: ProcStatus = procs.length ? extraction.status : "no_procedure";
  if (!procs.length) return { status, extraction, procedures: [], codes: [], usage };

  const procedures = await mapLimit(procs, cfg.rag.concurrency, async (p): Promise<CodedProcedure> => {
    try {
      const r = await retrieveCandidates(p.extracted_procedure || p.procedure_text);
      const skipped = !r.candidates.length ? "No candidate codes found" : r.topScore < cfg.rag.score_threshold ? `Best match ${r.topScore.toFixed(2)} is below ${cfg.rag.score_threshold}` : undefined;
      return { ...p, ...r, skipped };
    } catch (err) {
      return { ...p, candidates: [], topScore: 0, skipped: `Retrieval failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  const items: ToCode[] = procedures.flatMap((p, index) => (p.skipped ? [] : [{ index, proc: p, candidates: p.candidates }]));
  if (!items.length) return { status, extraction, procedures: procedures.map((p) => ({ ...p, outcome: "skipped" as const })), codes: [], usage };

  const { selections, usage: u2 } = await selectCodes(items, reportText(blocks).slice(0, cfg.report_max_chars));
  usage.push(...u2);
  for (const s of selections) {
    const p = procedures[s.index];
    if (p) p.selection = { code: s.code, confidence: s.confidence, rationale: s.rationale, source: s.source };
  }
  const codes = selections.map((s) => ({
    code: s.code,
    modifier: procedures[s.index]?.attempted ? cfg.attempted_modifier : "",
    description: s.description,
    confidence: s.confidence,
    reason: s.rationale,
    procedure: procedures[s.index]?.procedure_text ?? "",
  }));
  const final = finalize(codes, cfg.gate_threshold, cfg.attempted_modifier);
  for (const p of procedures) p.outcome = outcomeOf(p, final, cfg.gate_threshold);
  return { status, extraction, procedures, codes: final, usage };
}
