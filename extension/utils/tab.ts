import type { ContentRequest, DockMetrics } from "./messages";

/**
 * The panel is docked inside one tab, so it works on that tab, not whichever one is in front.
 * Outside a tab (a popup, for instance) it falls back to the active tab.
 */
let own: Promise<number | undefined> | undefined;
export function ownTabId(): Promise<number | undefined> {
  own ??= browser.tabs.getCurrent().then((t) => t?.id).catch(() => undefined);
  return own;
}

export async function activeTab() {
  const id = await ownTabId();
  if (id !== undefined) return browser.tabs.get(id);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
}

/** True when an event about `tabId` concerns the tab this panel is docked in. */
export async function isOwnTab(tabId: number | undefined): Promise<boolean> {
  const id = await ownTabId();
  return id === undefined || tabId === id;
}

/** Cut the docked panel off the right of a screenshot, so it shows only the page. */
async function cropToPage(base64: string): Promise<string> {
  const m = await sendToContent<DockMetrics>({ type: "dock:metrics" }).catch(() => null);
  if (!m?.docked || m.pageWidth >= m.viewportWidth) return base64;
  const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${base64}`)).blob());
  const width = Math.round(bitmap.width * (m.pageWidth / m.viewportWidth));
  const canvas = new OffscreenCanvas(width, bitmap.height);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** JPEG of the visible page, left of the docked panel, base64 without the data: prefix. */
export async function captureVisible(): Promise<string> {
  const tab = await activeTab();
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  return cropToPage(dataUrl.replace(/^data:image\/\w+;base64,/, ""));
}

/**
 * Send a message to the content script. Tabs opened before the extension was installed have
 * no content script yet, so inject it once and retry.
 */
export async function sendToContent<T>(message: ContentRequest): Promise<T> {
  return sendToTab<T>((await activeTab()).id as number, message);
}

/** The same, to a named tab: the background copy a report is read in. */
export async function sendToTab<T>(tabId: number, message: ContentRequest): Promise<T> {
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] });
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cheap fingerprint to tell whether the screen changed between two screenshots. */
export async function fingerprint(base64: string): Promise<string> {
  const bytes = new TextEncoder().encode(base64);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
