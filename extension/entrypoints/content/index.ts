import type { ContentRequest } from "@/utils/messages";
import { clickAt, scrollAt, typeText } from "./actions";
import { clickControl, listControls } from "./controls";
import { readDom } from "./domReader";
import { closeMicFrame, openMicFrame } from "./micFrame";
import { companionOff, companionOn, companionPause, setCompanionMode, showPrediction, type CompanionMode } from "./companion";
import { watchForReports, stopWatching } from "./permission";
import { pointAt } from "./pointer";
import { disablePushToTalk, enablePushToTalk } from "./pushToTalk";
import { disableSelection, enableSelection } from "./selection";
import { readWholeReport } from "./reportReader";
import { watchForChanges } from "./watch";

interface CompanionConfig {
  enabled: boolean;
  clinical_hints: string[];
  min_hits: number;
}

/** The companion and everything it does on the page, switched on or off together. */
function startCompanion(cfg: CompanionConfig): void {
  companionOn();
  enableSelection();
  enablePushToTalk();
  watchForReports(cfg.clinical_hints, cfg.min_hits);
}

function stopCompanion(): void {
  stopWatching();
  disablePushToTalk();
  disableSelection();
  companionOff();
}

export default defineContentScript({
  matches: ["<all_urls>"],
  main(ctx) {
    watchForChanges(ctx);
    // Codio was reloaded (or a fresh copy of this script arrived): this copy switches off.
    ctx.onInvalidated(stopCompanion);
    // The companion is on every page by default; the background says whether it is enabled.
    if (window.top === window) {
      browser.runtime
        .sendMessage({ type: "companion:config" })
        // A copy made stale while waiting (a newer copy arrived) must not start a second companion.
        .then((cfg: CompanionConfig | undefined) => cfg?.enabled && ctx.isValid && startCompanion(cfg))
        .catch(() => undefined);
    }
    browser.runtime.onMessage.addListener((message: ContentRequest) => {
      switch (message.type) {
        case "companion:on":
          browser.runtime
            .sendMessage({ type: "companion:config" })
            .then((cfg: CompanionConfig | undefined) => cfg && ctx.isValid && startCompanion({ ...cfg, enabled: true }))
            .catch(() => undefined);
          return Promise.resolve({ ok: true });
        case "companion:prediction":
          showPrediction(message.card, message.codes, message.focus);
          return Promise.resolve({ ok: true });
        case "companion:mode":
          setCompanionMode(message.mode as CompanionMode, message.text);
          return Promise.resolve({ ok: true });
        case "companion:off":
          stopCompanion();
          return Promise.resolve({ ok: true });
        // Fill mode belongs to the filler script, which answers these; the companion only steps aside.
        case "fill:arm":
          companionPause(true);
          return undefined;
        case "fill:disarm":
          companionPause(false);
          return undefined;
        case "ping":
          return Promise.resolve({ ok: true, detail: "ready" });
        case "dom:read":
          return Promise.resolve(readDom());
        case "controls:list":
          return Promise.resolve({ controls: listControls(message.blocked, message.max) });
        case "act:clickControl":
          return Promise.resolve(clickControl(message.id));
        case "act:click":
          return Promise.resolve(clickAt(message.x, message.y, message.blocked));
        case "act:scroll":
          return Promise.resolve(scrollAt(message.x, message.y, message.direction));
        case "act:type":
          return Promise.resolve(typeText(message.text));
        case "act:point":
          return Promise.resolve(pointAt(message.x, message.y, message.label));
        case "mic:frame:open":
          return Promise.resolve(openMicFrame(message.url));
        case "mic:frame:close":
          return Promise.resolve(closeMicFrame());
        case "report:read":
          return readWholeReport(message.maxSteps);
        case "dock:metrics":
          return Promise.resolve({ docked: false, pageWidth: innerWidth, viewportWidth: innerWidth });
        default:
          return undefined;
      }
    });
  },
});
