/**
 * Push-to-talk: hold Command+Option (Ctrl+Alt on Windows) and speak. The companion becomes the
 * listening mic; on release the background records' result is transcribed and the question is
 * answered right in the companion. Recording happens in an extension page that owns the
 * microphone permission, never in the site. Any other key during the hold cancels.
 *
 * Click-to-talk: the "Ask by voice" button on a highlight's card starts listening without a hold;
 * the next click anywhere (or Enter) sends the question and Escape cancels. A question asked while a
 * highlight with nothing to code is waiting is about that highlight.
 */
import { askByVoice, setCompanionMode } from "./companion";
import { looksClinical } from "./permission";
import { takeHighlight } from "./selection";

const CLICK_TALK_MAX_MS = 60_000;

let enabled = false;
let holding = false;
let clicked = false;
let clickTimer = 0;

const comboDown = (e: KeyboardEvent) => e.altKey && (e.metaKey || e.ctrlKey);
const isModifier = (key: string) => key === "Meta" || key === "Alt" || key === "Control" || key === "OS";

async function stop(cancel: boolean): Promise<void> {
  if (!holding) return;
  holding = false;
  if (clicked) endClickTalk();
  // Taken now, before the click that ends listening clears the waiting highlight.
  const about = takeHighlight();
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
    await askByVoice(r.text.trim(), looksClinical(), about);
  } catch {
    setCompanionMode("message", "I couldn't hear that clearly");
  }
}

const onClickTalkDown = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  void stop(false);
};
const onClickTalkKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape" && e.key !== "Enter") return;
  e.preventDefault();
  e.stopPropagation();
  void stop(e.key === "Escape");
};

function endClickTalk(): void {
  clicked = false;
  window.clearTimeout(clickTimer);
  document.removeEventListener("mousedown", onClickTalkDown, true);
  document.removeEventListener("keydown", onClickTalkKey, true);
}

/** Start listening from a button; the next click or Enter sends, Escape cancels. */
export function talkByClick(): void {
  if (!enabled || holding) return;
  holding = clicked = true;
  setCompanionMode("listening", "Listening… click when done");
  browser.runtime.sendMessage({ type: "ptt:start" }).catch(() => {
    endClickTalk();
    holding = false;
    setCompanionMode("message", "Codio isn't ready. Reload the page.");
  });
  // Added after this click has finished, so it does not end the question it started.
  window.setTimeout(() => {
    if (!clicked) return;
    document.addEventListener("mousedown", onClickTalkDown, true);
    document.addEventListener("keydown", onClickTalkKey, true);
  });
  clickTimer = window.setTimeout(() => void stop(false), CLICK_TALK_MAX_MS);
}

function onKeyDown(e: KeyboardEvent): void {
  if (clicked) return;
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
  if (holding && !clicked && !comboDown(e)) void stop(false);
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
