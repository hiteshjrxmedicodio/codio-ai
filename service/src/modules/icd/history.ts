/**
 * Coding a historical diagnosis. ICD-10-CM keeps history in two places: a personal-history or status
 * code in Z80–Z99 (most conditions), or an old / healed / sequela code in the condition's own chapter
 * (an old myocardial infarction). The engine's tree walk is poor at this: it heads for the condition
 * as if current, or into the Z chapter where the right entry sits several levels down. So history is
 * coded directly: every history-form code in the CMS tabular whose description (with its inclusion
 * terms and parents) names the condition is a candidate, and the Decisions API picks one. Only a
 * diagnosis with no candidate goes to the engine, walked twice (as written and as personal history),
 * and neither walk landing on a history form hands it to review with both codes rather than coding
 * it as if it were current.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_ROOT, getConfig } from "../../core/config";
import { decideChoice } from "../../core/llm/openai";
import { loadPrompt } from "../../core/prompts";
import type { Diagnosis } from "./extract";
import type { JevResult, JevTrail } from "./jev";

export const PICK_BLOCK_ID = "D-PICK-HISTORY";

/** The phrase already says it is history, so it is not prefixed again. */
export const SAYS_HISTORY = /\b(history|hx|previous|prior|old|past|resolved|status post|s\/p)\b/i;

export const HISTORY_NOTE =
  "This condition is documented as past history, not a current problem: the code is its personal-history form, or the old or sequela form where ICD-10-CM provides one for the condition itself.";

/** The uid of the second walk, as personal history. */
export const historyUid = (uid: string) => `${uid}h`;
export const baseUid = (uid: string) => uid.replace(/h$/, "");

export const asHistoryPhrase = (phrase: string) => (SAYS_HISTORY.test(phrase) ? phrase : `personal history of ${phrase}`);

/** A code line that is a history, status, old, healed or sequela form of a condition the patient had. */
const HISTORY_FORM = /personal history|\bold\b|healed|sequela|late effect|acquired absence|presence of|\bstatus\b(?!\s+(migrainosus|asthmaticus|epilepticus))/i;
/** Lines that are not the patient's own past: family history, congenital states, visits for aftercare. */
const NOT_OWN_PAST = /^(family history|congenital|encounter for)/i;
const STOP = new Set(["the", "and", "with", "without", "personal", "history", "prior", "previous", "old", "past", "status", "post", "disease", "disorder", "unspecified", "other", "specified"]);

/** The content words of a phrase or description, lightly stemmed so colonic meets colon and polyps meets polyp. */
function words(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.replace(/(ies|es|s)$/, "").replace(/(ic|al)$/, ""));
  }
  return out;
}

/** How many of the phrase's content words the text shares. */
function overlap(text: string, phrase: string): number {
  const d = words(text);
  let n = 0;
  for (const w of words(phrase)) if (d.has(w)) n++;
  return n;
}

/** The code's description names the condition the phrase does (one content word in common). */
export const namesCondition = (description: string | null | undefined, phrase: string): boolean => overlap(description ?? "", phrase) > 0;

interface TabularNode {
  name?: string;
  desc: string;
  inclusion?: string[];
  children?: TabularNode[];
  sections?: { cats: TabularNode[] }[];
}

export interface HistoryCode {
  code: string;
  description: string;
  /** The description, its inclusion terms and its parents' descriptions: what the code is matched on. */
  text: string;
}

let leaves: HistoryCode[] | null = null;

/** Every leaf code in the CMS tabular whose line names a history, status or old/sequela form, read once. */
export function historyCodes(): HistoryCode[] {
  if (leaves) return leaves;
  const file = join(SERVICE_ROOT, getConfig().icd_pipeline.jev_path, "inputs", "icd_tabular_2026.json");
  const chapters = JSON.parse(readFileSync(file, "utf8")) as TabularNode[];
  const out: HistoryCode[] = [];
  const visit = (n: TabularNode, parents: string[]): void => {
    const own = [n.desc, ...(n.inclusion ?? [])].join(". ");
    if (n.children?.length) {
      for (const c of n.children) visit(c, [...parents, own]);
      return;
    }
    const line = `${own} ${parents.at(-1) ?? ""}`;
    if (n.name && HISTORY_FORM.test(line) && !NOT_OWN_PAST.test(n.desc) && !NOT_OWN_PAST.test(parents.at(-1) ?? "")) {
      out.push({ code: n.name, description: n.desc, text: [...parents.slice(-2), own].join(". ") });
    }
  };
  for (const ch of chapters) for (const sec of ch.sections ?? []) for (const cat of sec.cats) visit(cat, []);
  leaves = out;
  return out;
}

/** The history-form codes naming this condition, best match first. */
export function historyCandidates(phrase: string, limit: number): HistoryCode[] {
  const scored = historyCodes()
    .map((c) => ({ c, own: overlap(c.description, phrase), all: overlap(c.text, phrase) }))
    .filter((x) => x.all > 0)
    // Named in the code's own line beats named only in a parent; then the more words shared the better.
    .sort((a, b) => b.own - a.own || b.all - a.all || a.c.code.localeCompare(b.c.code));
  return scored.slice(0, limit).map((x) => x.c);
}

const NONE = "none";

/**
 * Code a historical diagnosis from the tabular's history-form codes: the candidates naming it, then
 * one bounded pick among them. Null when nothing in the tabular names it (the engine walks it then).
 */
export async function codeHistory(uid: string, dx: Diagnosis, statements: Record<string, string>): Promise<JevResult | null> {
  const cands = historyCandidates(dx.phrase, getConfig().icd_pipeline.history_candidates);
  if (!cands.length) return null;
  const candidates: JevTrail["steps"][number] = { kind: "candidates", codes: cands.map((c) => c.code) };
  const result = (c: HistoryCode, confidence: number | null): JevResult => ({
    uid,
    code: c.code,
    description: c.description,
    trail: { start: [], steps: [candidates, { kind: "decide", chose: c.code, chose_desc: c.description, confidence }], fallback: false },
  });
  if (cands.length === 1) return result(cands[0] as HistoryCode, null);
  const text = [`DIAGNOSIS: ${dx.phrase}`, "STATUS: historical (past, resolved)", ...Object.entries(statements).map(([k, v]) => `${k.toUpperCase()}: ${v}`)].join("\n");
  const choices = [...cands.map((c) => ({ value: c.code, description: c.description })), { value: NONE, description: "None of these names this condition" }];
  try {
    const r = await decideChoice({ name: "history_code", instructions: loadPrompt(PICK_BLOCK_ID), choices, text });
    const pick = cands.find((c) => c.code === r.choice);
    if (pick) return result(pick, r.confidence);
  } catch {
    /* refused or unreachable: the engine walks it instead */
  }
  return null;
}

/** The result for a historical diagnosis from its two walks. */
export function pickHistory(asWritten: JevResult | undefined, asHistory: JevResult | undefined, phrase: string): JevResult {
  const fits = (r: JevResult | undefined) => Boolean(r?.code && HISTORY_FORM.test(r.description ?? "") && namesCondition(r.description, phrase));
  if (fits(asWritten)) return asWritten as JevResult;
  if (fits(asHistory)) return { ...(asHistory as JevResult), uid: baseUid((asHistory as JevResult).uid) };
  const candidates = [asWritten?.code, asHistory?.code].filter((c): c is string => Boolean(c));
  const error = asWritten?.error ?? asHistory?.error ?? null;
  return {
    uid: baseUid(asWritten?.uid ?? asHistory?.uid ?? ""),
    code: null,
    error,
    handoff: { required: true, reason: candidates.length ? "No code names this as history; the candidates code it as if current or name another condition" : "No history-form code was reached", candidate_codes: candidates },
    trail: asHistory?.trail ?? asWritten?.trail,
  };
}
