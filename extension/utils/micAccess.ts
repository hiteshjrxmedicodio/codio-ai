import { activeTab, sendToContent } from "./tab";

export type MicAccess = "granted" | "denied" | "prompt" | "unknown";

const WAIT_MS = 60_000;

export async function micPermission(): Promise<MicAccess> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

/** Where to fix a blocked microphone: Chrome's page for this extension's permissions. */
export function openMicSettings(): void {
  const site = encodeURIComponent(`chrome-extension://${browser.runtime.id}/`);
  browser.tabs.create({ url: `chrome://settings/content/siteDetails?site=${site}` });
}

function waitForAnswer(): Promise<"granted" | "denied"> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish("denied"), WAIT_MS);
    const onMessage = (m: { type?: string }) => {
      if (m?.type === "mic:granted") finish("granted");
      else if (m?.type === "mic:denied") finish("denied");
    };
    function finish(answer: "granted" | "denied") {
      window.clearTimeout(timer);
      browser.runtime.onMessage.removeListener(onMessage);
      resolve(answer);
    }
    browser.runtime.onMessage.addListener(onMessage);
  });
}

/**
 * Get microphone access without leaving the panel. A side panel cannot show Chrome's prompt,
 * so the request is made from a hidden frame on the page the provider is on, and Chrome's
 * Allow bubble appears there. Pages the extension cannot touch fall back to a small popup.
 */
export async function requestMicAccess(): Promise<"granted" | "denied"> {
  if ((await micPermission()) === "granted") return "granted";
  const url = browser.runtime.getURL("/mic.html?frame=1");
  const answer = waitForAnswer();
  try {
    await activeTab();
    await sendToContent({ type: "mic:frame:open", url });
  } catch {
    await browser.windows.create({ url: browser.runtime.getURL("/mic.html"), type: "popup", width: 440, height: 560, focused: true });
  }
  const result = await answer;
  sendToContent({ type: "mic:frame:close" }).catch(() => undefined);
  return result;
}
