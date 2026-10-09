/**
 * Push-to-talk: hold Command+Option (Ctrl+Alt on Windows) and speak. The companion becomes the
 * listening mic; on release the background records' result is transcribed and the question is
 * answered right in the companion. Recording happens in an extension page that owns the
 * microphone permission, never in the site. Any other key during the hold cancels.
 */
import { askByVoice, setCompanionMode } from "./companion";
import { looksClinical } from "./permission";

let enabled = false;
let holding = false;

const comboDown = (e: KeyboardEvent) => e.altKey && (e.metaKey || e.ctrlKey);
const isModifier = (key: string) => key === "Meta" || key === "Alt" || key === "Control" || key === "OS";

async function stop(cancel: boolean): Promise<void> {
  if (!holding) return;
  holding = false;
  if (cancel) {
    setCompanionMode("idle");
    if (browser.runtime?.id) browser.runtime.sendMessage({ type: "ptt:cancel" }).catch(() => undefined);
    return;
  }
  setCompanionMode("working");
  try {
    const r = (await browser.runtime.sendMessage({ type: "ptt:stop" })) as { text?: string; error?: string } | undefined;
    if (r?.error || !r?.text?.trim()) {
      setCompanionMode("message", r?.error ?? "I didn't catch that");
      return;
    }
    setCompanionMode("idle");
    await askByVoice(r.text.trim(), looksClinical());
  } catch {
    setCompanionMode("message", "I couldn't hear that clearly");
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (holding && !isModifier(e.key)) {
    void stop(true);
    return;
  }
  if (!holding && isModifier(e.key) && comboDown(e) && !e.shiftKey && !e.repeat) {
    holding = true;
    setCompanionMode("listening");
    browser.runtime.sendMessage({ type: "ptt:start" }).catch(() => setCompanionMode("message", "Codio isn't ready. Reload the page."));
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (holding && !comboDown(e)) void stop(false);
}

const onBlur = () => void stop(false);

export function enablePushToTalk(): void {
  if (enabled) return;
  enabled = true;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
}

export function disablePushToTalk(): void {
  void stop(true);
  enabled = false;
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("keyup", onKeyUp, true);
  window.removeEventListener("blur", onBlur);
}
