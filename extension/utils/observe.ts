import { api } from "./api";
import type { DomReadResult } from "./messages";
import { isChartSite } from "./chartSites";
import { activeTab, captureVisible, fingerprint, sendToContent } from "./tab";
import type { CheckResult, Observation, PageGate } from "./types";

/**
 * Gate results and check results are remembered per page. A page is its address plus a
 * fingerprint of the start of its text, so a single-page EMR that swaps notes without
 * changing the address still counts as a new page.
 */
const gates = new Map<string, { gate: PageGate; chars: number }>();
const checks = new Map<string, CheckResult>();
/** Pages already announced as readable, so a note is auto-checked once, not on every look. */
const announced = new Set<string>();

/**
 * A closed verdict is decided again once the page has grown by this much: single-page apps
 * render the shell first and the note a moment later, and the shell alone reads as not clinical.
 */
const REGATE_GROWTH_CHARS = 300;

export interface Observed {
  obs: Observation;
  gate: PageGate;
  key: string;
  /** True the first time this page is seen as readable. */
  firstReadable: boolean;
  /** The page is on a site the provider saved as where they read charts. */
  chartSite: boolean;
}

const CLOSED: PageGate = { status: "not_clinical", kind: "not_clinical", setting: "none", confidence: 1, provider: "extension" };

export function rememberCheck(key: string, result: CheckResult): void {
  checks.set(key, result);
}

export function overrideGate(key: string): void {
  gates.set(key, { gate: { status: "clinical", kind: "other_clinical", setting: "unknown", confidence: 1, provider: "provider override" }, chars: Infinity });
  announced.add(key);
}

async function readDom(): Promise<DomReadResult> {
  try {
    return await sendToContent<DomReadResult>({ type: "dom:read" });
  } catch {
    return { blocks: [], chars: 0 };
  }
}

/**
 * Look at the current tab. The privacy gate runs before anything from the page is used; a
 * closed gate returns an observation with nothing from the page in it.
 */
export async function observe(domMinChars: number, withScreenshot: boolean): Promise<Observed> {
  const tab = await activeTab();
  const url = tab.url ?? "";
  const title = tab.title ?? "";
  if (!/^(https?|file|blob):/.test(url)) {
    return { obs: { url, title, gate: { status: "not_clinical", kind: "not_clinical", setting: "none" } }, gate: CLOSED, key: url, firstReadable: false, chartSite: false };
  }
  const chartSite = await isChartSite(url);

  const dom = await readDom();
  const text = dom.blocks.map((b) => `${b.heading}\n${b.text}`).join("\n");
  // Digits are left out so a ticking timer or counter on the page does not make it a new page.
  const key = `${url}|${await fingerprint(text.slice(0, 800).replace(/\d+/g, ""))}`;

  const cached = gates.get(key);
  const stale = cached && cached.gate.status !== "clinical" && dom.chars >= cached.chars + REGATE_GROWTH_CHARS;
  let gate = cached && !stale ? cached.gate : undefined;
  if (!gate) {
    const shot = dom.chars < domMinChars ? await captureVisible() : undefined;
    const fresh = await api.pageCheck(text, shot).catch((err): PageGate => ({ ...CLOSED, note: String(err) }));
    // A failed call is not a verdict: leave it uncached so the next look asks again.
    if (fresh.provider !== "extension") gates.set(key, { gate: fresh, chars: dom.chars });
    gate = fresh;
  }
  // On a saved chart site the provider has already said yes: the gate only names the kind.
  if (chartSite && gate.status !== "clinical" && gate.provider !== "extension") {
    gate = { ...gate, status: "clinical", kind: "other_clinical", setting: "unknown", note: "saved chart site" };
  }

  const base = { url, title, gate: { status: gate.status, kind: gate.kind, setting: gate.setting } };
  if (gate.status !== "clinical") return { obs: base, gate, key, firstReadable: false, chartSite };
  const firstReadable = !announced.has(key);
  announced.add(key);
  return {
    obs: {
      ...base,
      blocks: dom.blocks,
      screenshot: withScreenshot ? await captureVisible() : undefined,
      checkSummary: checks.get(key)?.summary,
    },
    gate,
    key,
    firstReadable,
    chartSite,
  };
}
