/**
 * Decides, on this computer only, whether a page looks like a medical report: it counts how many
 * report section labels the page has ("Pre-op diagnosis", "Assessment:", "HPI:"). Nothing is sent anywhere. When it looks like one, the
 * companion asks permission to code it, on every visit: an earlier yes does not carry over to the next
 * time the provider opens the report, comes back to it or refreshes it.
 */
import { loadPreferences } from "@/utils/settings";
import { leaveReport, offerPermission, resumeReport } from "./companion";

let hints: string[] = [];
let minHits = 3;
let observer: MutationObserver | null = null;
let timer = 0;
let checks = 0;
let address = "";
let addressTimer = 0;
const ADDRESS_POLL_MS = 500;
const MAX_CHECKS = 6;
const SETTLE_MS = 1500;

/** A section label is short; anything longer is prose, which mentions "diagnosis" or "plan" on any page. */
const LABEL_MAX_WORDS = 5;

/**
 * The page's section labels: each line that is short on its own ("PRE OP DIAGNOSIS"), or the words before
 * the colon that starts a line ("Assessment: …"). Only these are matched, never the running text: a page
 * written about clinical coding (a README, an article) uses the same words in sentences and is not a report.
 */
function sectionLabels(): string[] {
  return (document.body?.innerText ?? "")
    .slice(0, 60_000)
    .toLowerCase()
    .split("\n")
    .map((line) => (line.trim().match(/^([^:]{2,60}):/)?.[1] ?? line).replace(/:$/, "").trim())
    .filter((l) => l && l.split(/\s+/).length <= LABEL_MAX_WORDS);
}

export function looksClinical(): boolean {
  if (!hints.length) return false;
  const labels = sectionLabels();
  let hits = 0;
  for (const h of hints) {
    const re = new RegExp(`(^|[^a-z])${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
    if (labels.some((l) => re.test(l)) && ++hits >= minHits) return true;
  }
  return false;
}

/**
 * Once the page looks like a report, ask before coding it: every time the provider arrives on it (opening
 * it, coming back to it, refreshing it), whatever they answered on an earlier visit. Only "Read notes
 * without asking" in Settings, a standing yes, codes it straight away.
 */
async function check(): Promise<void> {
  if (checks >= MAX_CHECKS) return;
  checks++;
  if (looksClinical()) {
    observer?.disconnect();
    const standingYes = await loadPreferences().then((p) => p.autoCheck).catch(() => false);
    if (standingYes) resumeReport();
    else offerPermission();
  }
}

/**
 * Single-page apps change their address without reloading, so the content script outlives the report.
 * On a new address the old report's highlights and cards are dropped and the new page is looked at fresh.
 */
function onAddress(): void {
  if (location.href === address) return;
  address = location.href;
  leaveReport();
  checks = 0;
  soon();
  if (document.body && observer) observer.observe(document.body, { childList: true, subtree: true });
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
  address = location.href;
  window.clearInterval(addressTimer);
  addressTimer = window.setInterval(onAddress, ADDRESS_POLL_MS);
}

export function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  window.clearTimeout(timer);
  window.clearInterval(addressTimer);
}
