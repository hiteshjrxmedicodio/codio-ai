import { post } from "./service";

/**
 * Push-to-talk recording. A service worker cannot use the microphone, so an offscreen extension
 * page records; it shares the extension's microphone permission, so the site never gets it.
 */
const OFFSCREEN_URL = "/offscreen.html";
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const has = await browser.offscreen.hasDocument?.().catch(() => false);
  if (has) return;
  creating ??= browser.offscreen
    .createDocument({ url: OFFSCREEN_URL, reasons: ["USER_MEDIA"] as unknown as never, justification: "Record push-to-talk questions for Codio AI" })
    .finally(() => {
      creating = null;
    });
  await creating;
}

const toOffscreen = <T>(type: string) => browser.runtime.sendMessage({ target: "offscreen", type }) as Promise<T>;

/** Ask Chrome for the microphone from the page the provider is on (side panels and workers cannot). */
async function requestMic(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  const url = browser.runtime.getURL("/mic.html?frame=1");
  await browser.tabs.sendMessage(tabId, { type: "mic:frame:open", url }).catch(() => undefined);
  await new Promise<void>((resolve) => {
    const done = (m: { type?: string }) => {
      if (m?.type !== "mic:granted" && m?.type !== "mic:denied") return;
      browser.runtime.onMessage.removeListener(done);
      resolve();
    };
    browser.runtime.onMessage.addListener(done);
    setTimeout(() => {
      browser.runtime.onMessage.removeListener(done);
      resolve();
    }, 60_000);
  });
  await browser.tabs.sendMessage(tabId, { type: "mic:frame:close" }).catch(() => undefined);
}

let started: Promise<{ ok: boolean; error?: string }> | null = null;

export function startRecording(tabId: number | undefined): void {
  started = ensureOffscreen()
    .then(() => toOffscreen<{ ok: boolean; error?: string }>("rec:start"))
    .then(async (r) => {
      if (r?.error === "permission") void requestMic(tabId);
      return r ?? { ok: false, error: "no-recorder" };
    })
    .catch((err) => ({ ok: false, error: String(err) }));
}

/** Stop and transcribe. Returns the text, or an error the companion can show. */
export async function stopRecording(): Promise<{ text?: string; error?: string }> {
  const s = await started;
  started = null;
  if (!s?.ok) return { error: s?.error === "permission" ? "Allow the microphone, then hold ⌘⌥ again" : "The microphone isn't available" };
  const audio = await toOffscreen<{ base64?: string; mimeType?: string }>("rec:stop");
  if (!audio?.base64) return { error: "I didn't catch that" };
  const r = await post<{ text: string }>("/v1/voice/transcribe", { audio: audio.base64, mimeType: audio.mimeType ?? "audio/webm" });
  return "error" in r ? { error: "I couldn't hear that clearly" } : { text: r.text };
}

export async function cancelRecording(): Promise<void> {
  const s = await started;
  started = null;
  if (s?.ok) await toOffscreen("rec:stop").catch(() => undefined);
}
