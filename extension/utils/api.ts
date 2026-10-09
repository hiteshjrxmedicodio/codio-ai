import { SERVICE_URL } from "./settings";

/** One part of a dictated report: config section name, display title, and the text for it. */
export interface ReportSection {
  name: string;
  title: string;
  text: string;
}
import type {
  AgentSettings,
  AgentTurnOutput,
  CapturedBlock,
  CareSetting,
  CheckResult,
  Control,
  FixReply,
  Observation,
  PageGate,
  ReportSummary,
  Section,
  Suggestion,
  ToolResult,
} from "./types";

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${SERVICE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Service returned ${res.status}`);
  return data as T;
}

export const api = {
  health: () => call<{ ok: boolean }>("/health"),
  settings: () => call<AgentSettings>("/v1/agent/settings"),
  pageCheck: (text: string, screenshot?: string) => call<PageGate>("/v1/page/check", { text, screenshot }),
  agentTurn: (
    body: { history: unknown[]; userText?: string; toolResults?: ToolResult[]; observation: Observation },
    signal?: AbortSignal,
  ) => call<AgentTurnOutput>("/v1/agent/turn", body, signal),
  pickControl: (goal: string, title: string, controls: Control[]) =>
    call<{ id: string | null; confidence: number; reason: string }>("/v1/agent/pick-control", { goal, title, controls }),
  checkPage: (blocks: CapturedBlock[] | undefined, screenshots: string[] | undefined, setting: CareSetting) =>
    call<CheckResult>("/v1/cdi/check-page", { blocks, screenshots, setting }),
  fix: (suggestion: Suggestion, sections: Section[], setting: CareSetting) =>
    call<{ fix: FixReply }>("/v1/cdi/fix", { suggestion, sections, setting }),
  summarizeReport: (body: {
    title: string;
    blocks?: CapturedBlock[];
    pdf?: { name: string; data: string };
    screenshots?: string[];
    coverage: { reachedEnd: boolean; steps: number; method: string };
  }) => call<ReportSummary>("/v1/report/summarize", body),
  askReport: (body: { title: string; report: string; question: string; earlier: { q: string; a: string }[] }) =>
    call<{ answer: string }>("/v1/report/ask", body),
  fileLimits: () => call<{ maxMb: number; maxFiles: number; types: string[] }>("/v1/files/limits"),
  readFile: (name: string, mimeType: string, data: string) =>
    call<{ name: string; sections: Section[]; chars: number }>("/v1/files/read", { name, mimeType, data }),
  dictateReport: (audio: string, mimeType: string) =>
    call<{ transcript: string; sections: ReportSection[] }>("/v1/dictation/report", { audio, mimeType }),
  transcribePiece: (audio: string, mimeType: string, previous: string) =>
    call<{ text: string }>("/v1/dictation/transcribe", { audio, mimeType, previous }),
  structureTranscript: (transcript: string) => call<{ sections: ReportSection[] }>("/v1/dictation/structure", { transcript }),
  matchField: (body: { label: string; nearby: string; title: string; sections: string[] }) =>
    call<{ section: string | null; confidence: number; how: string }>("/v1/dictation/match", body),
  transcribe: (audio: string, mimeType: string) =>
    call<{ raw: string; text: string; rephrased: boolean }>("/v1/voice/transcribe", { audio, mimeType }),
  feedback: (suggestion: Suggestion, vote: "up" | "down", setting: CareSetting) =>
    call<{ ok: boolean }>("/v1/feedback", {
      suggestionId: suggestion.id,
      vote,
      block: suggestion.block,
      kind: suggestion.kind,
      gateAnswer: suggestion.gate.answer,
      title: suggestion.title,
      quotes: suggestion.quotes,
      setting,
    }),
};
