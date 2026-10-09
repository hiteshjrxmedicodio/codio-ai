/**
 * Tells the side panel when the page's content has changed and then stayed still. Single-page
 * apps draw the note well after their load event, so without this the panel would judge the
 * empty shell and never look again. Only a signal is sent, never anything from the page.
 * After Codio is reloaded the copy of this script left in the page is stale: it stops watching
 * instead of throwing "Extension context invalidated" on every change.
 */
import type { ContentScriptContext } from "wxt/utils/content-script-context";

const SETTLE_MS = 1200;
/** Smaller changes (a ticking timer, a hover tooltip) are not worth a new look. */
const MIN_CHANGE_CHARS = 200;

export function watchForChanges(ctx: ContentScriptContext): void {
  if (window.top !== window) return;
  let lastLength = document.body?.innerText.length ?? 0;
  let timer: number | undefined;
  const settle = () => {
    // Asking also notices a reload: a stale copy tears itself down through onInvalidated.
    if (!ctx.isValid) return;
    const length = document.body?.innerText.length ?? 0;
    if (Math.abs(length - lastLength) < MIN_CHANGE_CHARS) return;
    lastLength = length;
    browser.runtime.sendMessage({ type: "page:changed" }).catch(() => undefined);
  };
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(settle, SETTLE_MS);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  ctx.onInvalidated(() => {
    observer.disconnect();
    window.clearTimeout(timer);
  });
}
