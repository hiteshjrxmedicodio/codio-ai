/** Shared shapes for the service. The extension keeps a copy in extension/lib/types.ts. */

export type CareSetting = "operative" | "enm" | "inpatient" | "unknown";

export interface Section {
  name: string;
  text: string;
}

export interface Quote {
  section: string;
  text: string;
}

/** "wording" is retired (preprocessing owns writing errors); it stays so saved findings still read. */
export type FindingKind = "contradiction" | "ambiguity" | "unaddressed" | "validation" | "wording" | "record";

export type GateAnswer = "not_real" | "not_critical" | "coding" | "denial" | "interpretation";

export interface Finding {
  id: string;
  block: string;              // the block that produced it (P-CON, K3, ...)
  kind: FindingKind;
  title: string;              // one plain sentence
  quotes: Quote[];
  detail: Record<string, unknown>;
  confidence: number;
  alsoFoundBy?: string[];
}

export interface GateResult {
  answer: GateAnswer;
  reason: string;
  confidence: number;
  source: "P-GATE" | "decisions" | "rule";
}

export interface Suggestion extends Finding {
  gate: GateResult;
}

export interface Usage {
  block: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  ms: number;
}

export interface BlockError {
  block: string;
  message: string;
}

export interface AnalyzeResult {
  suggestions: Suggestion[];
  hidden: Suggestion[];
  dropped: { finding: Finding; reason: string }[];
  usage: Usage[];
  errors: BlockError[];
  prescreen?: { run: string[]; skipped: { finder: string; probability: number }[]; note?: string };
  ms: number;
}
