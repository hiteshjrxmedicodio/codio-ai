import { api } from "./api";
import type { ActionResult, ControlsResult } from "./messages";
import { observe, rememberCheck } from "./observe";
import { BLOCKED_CONTROLS } from "./settings";
import { sendToContent, sleep } from "./tab";
import type { AgentSettings, AttachedDoc, CheckResult, ClientCall, ToolResult } from "./types";

const MAX_CONTROLS = 60;

export interface LoopCallbacks {
  say: (text: string, final: boolean) => void;
  status: (text: string) => void;
  check: (result: CheckResult, setting: string) => void;
}

const num = (v: unknown, fallback = 500) => (typeof v === "number" ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function clickByGoal(goal: string, blocked: string, title: string): Promise<ActionResult & { confidence?: number }> {
  const { controls } = await sendToContent<ControlsResult>({ type: "controls:list", blocked, max: MAX_CONTROLS });
  const pick = await api.pickControl(goal, title, controls);
  if (!pick.id) return { ok: false, detail: pick.reason };
  const r = await sendToContent<ActionResult>({ type: "act:clickControl", id: pick.id });
  return { ...r, detail: `${pick.reason}. ${r.detail}`, confidence: pick.confidence };
}

/** Carry out one browser tool. Every result goes back to the model as the tool's response. */
async function execute(call: ClientCall, blocked: string, title: string): Promise<ActionResult> {
  const a = call.args;
  switch (call.name) {
    case "point":
      return sendToContent({ type: "act:point", x: num(a.x), y: num(a.y), label: str(a.label) });
    case "click_control":
      return clickByGoal(str(a.goal), blocked, title);
    case "click":
      return sendToContent({ type: "act:click", x: num(a.x), y: num(a.y), blocked });
    case "scroll":
      return sendToContent({ type: "act:scroll", x: num(a.x), y: num(a.y), direction: a.direction === "up" ? "up" : "down" });
    case "type_text":
      return sendToContent({ type: "act:type", text: str(a.text) });
    case "wait":
      await sleep(1500);
      return { ok: true, detail: "Waited" };
    case "look":
      return { ok: true, detail: "Looked again" };
    default:
      return { ok: false, detail: `Unknown tool ${call.name}` };
  }
}

/** Plain words for the steps line, so a doctor can follow what happened. */
function describe(call: ClientCall, r: ActionResult): string {
  const a = call.args;
  if (!r.ok) return call.name === "click_control" ? `Couldn't find “${str(a.goal)}” on the page` : `Couldn't ${call.name.replace("_", " ")}: ${r.detail}`;
  switch (call.name) {
    case "point":
      return `Pointed to ${str(a.label)}`;
    case "click_control":
      return `Opened “${str(a.goal)}”`;
    case "click":
      return `Clicked ${str(a.target) || "the page"}`;
    case "scroll":
      return a.direction === "up" ? "Scrolled up" : "Scrolled down";
    case "type_text":
      return "Typed into the search box";
    case "wait":
      return "Waited for the page to load";
    default:
      return "Looked at the page";
  }
}

/**
 * One provider message, run to completion: observe → agent turn → carry out browser tools →
 * observe → … until the agent replies, the step limit is reached or the provider stops it.
 * Returns the updated history for the next message.
 */
export async function runAgent(
  text: string,
  history: unknown[],
  settings: AgentSettings,
  cb: LoopCallbacks,
  signal: AbortSignal,
  docs: AttachedDoc[] = [],
): Promise<unknown[]> {
  // Attached documents ride along with every observation, so the agent can always refer to them.
  const look = async () => {
    const s = await observe(settings.agent.dom_min_chars, true);
    if (docs.length) s.obs.attachments = docs;
    return s;
  };
  let seen = await look();
  let res = await api.agentTurn({ history, userText: text, observation: seen.obs }, signal);

  for (let step = 0; step <= settings.agent.max_steps; step++) {
    history = res.history;
    if (res.check) {
      rememberCheck(seen.key, res.check);
      cb.check(res.check, seen.gate.setting);
    }
    if (res.text) cb.say(res.text, res.done || !res.clientCalls.length);
    if (res.done || !res.clientCalls.length) return history;
    if (signal.aborted) {
      cb.status("Stopped.");
      return history;
    }

    const results: ToolResult[] = [];
    for (const call of res.clientCalls) {
      const r = await execute(call, BLOCKED_CONTROLS, seen.obs.title).catch((err): ActionResult => ({ ok: false, detail: String(err) }));
      cb.status(describe(call, r));
      results.push({ id: call.id, name: call.name, response: { ...r } });
    }
    await sleep(700);
    seen = await look();
    res = await api.agentTurn({ history, toolResults: [...results, ...res.pendingResults], observation: seen.obs }, signal);
  }
  cb.status("Reached the step limit. Tell me how you'd like to continue.");
  return history;
}
