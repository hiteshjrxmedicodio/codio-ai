import type { Content, FunctionCall, Part } from "@google/genai";
import { getConfig } from "../../core/config";
import { callWithTools } from "../../core/llm/geminiChat";
import type { CareSetting, Usage } from "../../core/types";
import { analyzeNote } from "../cdi/pipeline/analyze";
import { checkPageContent, summariseForAgent, type PageCheckResult } from "../cdi/pipeline/checkPage";
import { observationParts, trimHistory, type Observation } from "./observation";
import { AGENT_TOOLS, CLIENT_TOOLS, SERVER_TOOLS } from "./tools";

export const BLOCK_ID = "P-AGENT";

export interface ToolResult {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface AgentTurnInput {
  history: Content[];
  userText?: string;
  toolResults?: ToolResult[];
  observation: Observation;
}

export interface ClientCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentTurnOutput {
  history: Content[];
  text: string;
  done: boolean;
  clientCalls: ClientCall[];
  /** Server-tool results the extension must send back with its own results next turn. */
  pendingResults: ToolResult[];
  check?: PageCheckResult;
  usage: Usage[];
}

async function runServerTool(call: FunctionCall, obs: Observation): Promise<{ result: ToolResult; check?: PageCheckResult }> {
  const base = { id: call.id, name: call.name ?? "unknown" };
  if (call.name !== "run_documentation_check") return { result: { ...base, response: { error: "Unknown tool" } } };

  // An attached document is checked when the agent names one, or when it is the only thing to check.
  const wanted = String((call.args as { document?: string } | undefined)?.document ?? "").trim().toLowerCase();
  const docs = obs.attachments ?? [];
  const doc = wanted
    ? docs.find((d) => d.name.toLowerCase() === wanted) ?? docs.find((d) => d.name.toLowerCase().includes(wanted))
    : obs.gate.status !== "clinical" && docs.length === 1 ? docs[0] : undefined;
  if (doc) {
    try {
      const result = await analyzeNote(doc.sections, "unknown");
      const check: PageCheckResult = { ...result, sections: doc.sections, summary: summariseForAgent(result) };
      return { result: { ...base, response: { document: doc.name, summary: check.summary } }, check };
    } catch (err) {
      return { result: { ...base, response: { error: String(err instanceof Error ? err.message : err) } } };
    }
  }
  if (wanted) return { result: { ...base, response: { error: `No attached document matches ${wanted}.` } } };

  if (obs.gate.status !== "clinical") {
    return { result: { ...base, response: { error: "The privacy gate judged this page not clinical; nothing was checked." } } };
  }
  try {
    const setting = (obs.gate.setting === "none" ? "unknown" : obs.gate.setting) as CareSetting;
    const check = await checkPageContent({ blocks: obs.blocks, screenshots: obs.screenshot ? [obs.screenshot] : [] }, setting);
    return { result: { ...base, response: { summary: summariseForAgent(check) } }, check };
  } catch (err) {
    return { result: { ...base, response: { error: String(err instanceof Error ? err.message : err) } } };
  }
}

function userContent(input: AgentTurnInput): Content {
  const parts: Part[] = (input.toolResults ?? []).map((r) => ({ functionResponse: { id: r.id, name: r.name, response: r.response } }));
  if (input.userText?.trim()) parts.push({ text: `PROVIDER: ${input.userText.trim()}` });
  parts.push(...observationParts(input.observation));
  return { role: "user", parts };
}

/**
 * One provider-facing turn. The service is stateless: the extension keeps `history` and sends it
 * back. Server tools (the documentation check) run here and loop; browser tools are returned
 * as clientCalls for the extension to carry out, after which it calls this again.
 */
export async function agentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const contents = [...trimHistory(input.history), userContent(input)];
  const usage: Usage[] = [];
  let check: PageCheckResult | undefined;
  const texts: string[] = [];

  for (let round = 0; round < 3; round++) {
    const turn = await callWithTools(BLOCK_ID, contents, AGENT_TOOLS);
    usage.push(turn.usage);
    if (turn.content) contents.push(turn.content);
    if (turn.text) texts.push(turn.text);

    const clientCalls = turn.calls.filter((c) => CLIENT_TOOLS.has(c.name ?? ""));
    const serverCalls = turn.calls.filter((c) => SERVER_TOOLS.has(c.name ?? "") || !CLIENT_TOOLS.has(c.name ?? ""));
    const pendingResults: ToolResult[] = [];
    for (const call of serverCalls) {
      const r = await runServerTool(call, input.observation);
      pendingResults.push(r.result);
      check = r.check ?? check;
    }

    if (!turn.calls.length) return { history: contents, text: texts.join("\n\n"), done: true, clientCalls: [], pendingResults: [], check, usage };
    if (clientCalls.length) {
      const calls = clientCalls.map((c) => ({ id: c.id, name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown> }));
      return { history: contents, text: texts.join("\n\n"), done: false, clientCalls: calls, pendingResults, check, usage };
    }
    contents.push({
      role: "user",
      parts: pendingResults.map((r) => ({ functionResponse: { id: r.id, name: r.name, response: r.response } })),
    });
  }
  const fallback = "I could not finish that. Please ask again in a different way.";
  return { history: contents, text: texts.join("\n\n") || fallback, done: true, clientCalls: [], pendingResults: [], check, usage };
}

export function agentSettings() {
  const { agent, page_check, features, report, dictation, companion } = getConfig();
  return { agent, pageCheckProvider: page_check.provider, features, report, companion, dictation: { segment_seconds: dictation.segment_seconds } };
}
