import type { DomReadResult, ReportScrollResult } from "./messages";
import { sendToTab, sleep } from "./tab";

/**
 * A copy of the provider's report, opened in a background tab next to theirs and grouped with it,
 * so reading (which scrolls) happens there while their own screen stays put. The copy is opened
 * by address, inactive, so nothing flashes; it shares the browser's sign-in, so it shows the same
 * chart. It is closed again as soon as the read is done.
 */
export interface WorkTab {
  id: number;
  close: () => Promise<void>;
}

const GROUP_TITLE = "Codio";
const SETTLE_POLL_MS = 700;

function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("The copy of the report took too long to load")), timeoutMs);
    const onUpdated = (id: number, info: { status?: string }) => id === tabId && info.status === "complete" && finish();
    function finish(err?: Error) {
      window.clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      if (err) reject(err);
      else resolve();
    }
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.get(tabId).then((t) => t.status === "complete" && finish(), () => undefined);
  });
}

/** Single-page EMRs draw the chart after the load event: wait until its text stops growing. */
async function waitForContent(tabId: number, minChars: number, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < until) {
    const dom = await sendToTab<DomReadResult>(tabId, { type: "dom:read" }).catch(() => null);
    const chars = dom?.chars ?? 0;
    if (chars >= minChars && chars === last) return;
    last = chars;
    await sleep(SETTLE_POLL_MS);
  }
  throw new Error("The copy of the report never finished drawing");
}

/** Put the copy in a tab group with the provider's tab: their own group if they have one, else a new "Codio" group. */
async function group(sourceId: number, workId: number, sourceGroup: number | undefined): Promise<boolean> {
  try {
    if (sourceGroup !== undefined && sourceGroup >= 0) {
      await browser.tabs.group({ groupId: sourceGroup, tabIds: [workId] });
      return false;
    }
    const groupId = await browser.tabs.group({ tabIds: [sourceId, workId] });
    await browser.tabGroups.update(groupId, { title: GROUP_TITLE, color: "blue" }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function openWorkTab(source: { id?: number; url?: string; index: number; windowId: number; groupId?: number }, minChars: number, loadSeconds: number): Promise<WorkTab> {
  if (!source.id || !source.url) throw new Error("No report tab to copy");
  const sourceId = source.id;
  const work = await browser.tabs.create({ url: source.url, active: false, index: source.index + 1, windowId: source.windowId, openerTabId: sourceId });
  const workId = work.id as number;
  const madeGroup = await group(sourceId, workId, source.groupId);
  const close = async () => {
    await browser.tabs.remove(workId).catch(() => undefined);
    // A group made only for the copy is taken apart again; the provider's own groups are left alone.
    if (madeGroup) await browser.tabs.ungroup(sourceId).catch(() => undefined);
  };
  try {
    await waitForLoad(workId, loadSeconds * 1000);
    await waitForContent(workId, minChars, loadSeconds * 1000);
    return { id: workId, close };
  } catch (err) {
    await close();
    throw err;
  }
}

/** Scroll the copy to the end of its report and read all of it. */
export function readWorkTab(tab: WorkTab, maxSteps: number): Promise<ReportScrollResult> {
  return sendToTab<ReportScrollResult>(tab.id, { type: "report:read", maxSteps });
}
