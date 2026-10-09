/** Mirrors the service's shapes. Keep in step with service/src/core/types.ts and modules/agent. */

export type CareSetting = "operative" | "enm" | "inpatient" | "unknown";
export type GateAnswer = "not_real" | "not_critical" | "coding" | "denial" | "interpretation";

export interface Section {
  name: string;
  text: string;
}

export interface Quote {
  section: string;
  text: string;
}

export interface CapturedBlock {
  heading: string;
  text: string;
}

export interface Suggestion {
  id: string;
  block: string;
  kind: "contradiction" | "ambiguity" | "unaddressed" | "validation" | "wording" | "record";
  title: string;
  quotes: Quote[];
  detail: Record<string, unknown>;
  confidence: number;
  alsoFoundBy?: string[];
  gate: { answer: GateAnswer; reason: string; confidence: number; source: string };
}

export interface CheckResult {
  suggestions: Suggestion[];
  hidden: Suggestion[];
  sections: Section[];
  summary: string;
  errors: { block: string; message: string }[];
  prescreen?: { run: string[]; skipped: { finder: string; probability: number }[] };
  ms: number;
}

export interface FixReply {
  title: string;
  guidance: string;
  choices: string[];
}

/** Result of the privacy gate for one page. */
export interface PageGate {
  status: "clinical" | "not_clinical";
  kind: string;
  setting: CareSetting | "none";
  confidence: number;
  provider: string;
  note?: string;
}

export interface Observation {
  url: string;
  title: string;
  gate: { status: PageGate["status"]; kind: string; setting: PageGate["setting"] };
  blocks?: CapturedBlock[];
  screenshot?: string;
  checkSummary?: string;
  attachments?: AttachedDoc[];
}

export interface ClientCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface AgentTurnOutput {
  history: unknown[];
  text: string;
  done: boolean;
  clientCalls: ClientCall[];
  pendingResults: ToolResult[];
  check?: CheckResult;
}

/** A report read end to end and summarised field by field. */
export interface ReportSummary {
  report_type: string;
  overview: string;
  fields: { name: string; unlabelled: boolean; summary: string; key_details: string[] }[];
  empty_fields: string[];
  source: "page" | "pdf" | "screens";
  chars: number;
  coverage: { reachedEnd: boolean; steps: number; method: string };
  /** The report text that was summarised; follow-up questions are answered from it. */
  text: string;
}


/** One question about the open report and its answer. */
export interface ReportQA {
  q: string;
  a: string;
}

/** One diagnosis the on-page ICD run found: its phrase, its code (or why none) and the engine's trail. */
export interface SavedDiagnosis {
  phrase: string;
  status: string;
  quotes: Quote[];
  code: string | null;
  description: string | null;
  reviewReason: string | null;
  trail?: unknown;
}

/**
 * The on-page review of a report: its suggestions, the provider's thumbs on them (by position),
 * and the "what to change" written for each thumbs up.
 */
export interface SavedReview {
  suggestions: Suggestion[];
  votes: Record<number, "up" | "down">;
  fixes: Record<number, { guidance: string; choices: string[] }>;
}

export interface AgentSettings {
  features?: { summary_only: boolean };
  report?: { max_scroll_steps: number; max_screens: number; max_chars: number; background_tab?: boolean; background_load_seconds?: number };
  dictation?: { segment_seconds: number };
  agent: {
    max_steps: number;
    dom_min_chars: number;
    auto_check_on_new_note: boolean;
    history_max_chats: number;
    history_keep_days: number;
    chart_id_labels?: string[];
  };
  pageCheckProvider: string;
}

export interface Control {
  id: string;
  label: string;
  role: string;
  where: string;
}

/** A document the provider attached, already read into sections by the service. */
export interface AttachedDoc {
  name: string;
  sections: Section[];
}

/** A file waiting in the composer: being read, ready to send, or failed. */
export interface PendingFile {
  id: string;
  name: string;
  status: "reading" | "ready" | "error";
  doc?: AttachedDoc;
  error?: string;
}

export interface ChatItem {
  id: string;
  /** status = a notice about the page; step = something the agent did while working. */
  role: "user" | "assistant" | "status" | "step";
  text: string;
  check?: CheckResult;
  setting?: CareSetting;
  /** Set on an assistant item asking to read a page the gate closed; holds the provider's question. */
  ask?: { question: string; answered: boolean };
  /** Documents attached to this user message. */
  attachments?: AttachedDoc[];
}
