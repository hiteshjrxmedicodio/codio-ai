/**
 * Decides, on this computer only, whether a page looks like a medical report: it counts how many
 * report headings appear in the page text. Nothing is sent anywhere. When it looks like one, the
 * companion asks permission to read it; the provider's answer is remembered for the session, and
 * after a refresh a yes brings the suggestions back (from the session cache, or by reading again).
 */
import { loadPreferences } from "@/utils/settings";
import { consent, offerPermission, resumeReport } from "./companion";

let hints: string[] = [];
let minHits = 3;
let observer: MutationObserver | null = null;
let timer = 0;
let checks = 0;
const MAX_CHECKS = 6;
const SETTLE_MS = 1500;

export function looksClinical(): boolean {
  if (!hints.length) return false;
  const text = (document.body?.innerText ?? "").slice(0, 60_000).toLowerCase();
  let hits = 0;
  for (const h of hints) {
    if (new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text) && ++hits >= minHits) return true;
  }
  return false;
}

/**
 * Once the page looks like a report: ask, or, when the provider already said yes this session
 * (they refreshed or came back), bring the suggestions back without asking again.
 */
async function check(): Promise<void> {
  const answer = consent();
  if (answer === "declined" || checks >= MAX_CHECKS) return;
  checks++;
  if (looksClinical()) {
    observer?.disconnect();
    // "Read notes without asking" in Settings is a standing yes: read straight away.
    const standingYes = await loadPreferences().then((p) => p.autoCheck).catch(() => false);
    if (answer === "allowed" || standingYes) resumeReport();
    else offerPermission();
  }
}

/** Single-page EMRs draw the note after load, so look again whenever the page settles. */
const soon = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void check(), SETTLE_MS);
};

export function watchForReports(clinicalHints: string[], hitsNeeded: number): void {
  hints = clinicalHints.map((h) => h.toLowerCase());
  minHits = hitsNeeded;
  checks = 0;
  soon();
  observer?.disconnect();
  observer = new MutationObserver(soon);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
}

export function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  window.clearTimeout(timer);
}
