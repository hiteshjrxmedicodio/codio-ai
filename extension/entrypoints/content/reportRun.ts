/** The report run's reply (CDI → diagnoses and ICD-10 → procedures and CPT) in the shapes the companion keeps. */
import { messageCard, predictionCard, type Code } from "./companionUi/cards";
import type { CodedDiagnosis } from "./companionUi/icdCards";

export interface CptCard {
  codes: Code[];
  error?: string;
}

interface Reply {
  icd?: { diagnoses?: CodedDiagnosis[]; engineError?: string; error?: string };
  cpt?: { codes?: (Code & { modifier: string })[]; error?: string };
  error?: string;
}

export function readRun(r: Reply): { icd: { diagnoses: CodedDiagnosis[]; engineError?: string }; cpt: CptCard } {
  if (r.error || !r.icd) throw new Error(r.error ?? "no result came back");
  if (r.icd.error || !r.icd.diagnoses) throw new Error(r.icd.error ?? "no diagnoses came back");
  const cpt: CptCard = r.cpt?.codes
    ? { codes: r.cpt.codes.map((c) => ({ ...c, code: c.code + c.modifier })) }
    : { codes: [], error: `I couldn't code the procedures. ${r.cpt?.error ?? ""}`.trim() };
  return { icd: { diagnoses: r.icd.diagnoses, engineError: r.icd.engineError }, cpt };
}

/** The CPT card: the codes, or why the procedures couldn't be coded. */
export const cptCardHtml = (c: CptCard): string => (c.error ? messageCard("CPT prediction", c.error) : predictionCard("cpt", c.codes));
