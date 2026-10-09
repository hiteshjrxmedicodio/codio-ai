/**
 * Codio's background. The toolbar icon opens the side panel for chatting; the Codio AI companion
 * runs on every page by itself, and its requests come here because a web page cannot call the
 * local service. Push-to-talk recording goes through an offscreen extension page.
 */
import { cancelRecording, startRecording, stopRecording } from "@/utils/bg/recorder";
import { recallReport, rememberReport } from "@/utils/bg/reportCache";
import { saveReview, type ReviewSave } from "@/utils/bg/reviewStore";
import { companionSettings, get, post } from "@/utils/bg/service";
import type { ScriptPublicPath } from "wxt/utils/inject-script";

type Message = { type?: string; [key: string]: unknown };

/**
 * PDFs open in Codio's viewer, because Chrome lets no extension run inside its own PDF viewer.
 * Files the provider sent back to Chrome's viewer are skipped for the rest of the session.
 */
const VIEWER = "/viewer.html";
const SKIP_KEY = "codio-pdf-skip";
const isPdf = (url: string) => /^(https?|file):/i.test(url) && /\.pdf($|[?#])/i.test(url);

async function skipped(): Promise<string[]> {
  return ((await browser.storage.session.get(SKIP_KEY))[SKIP_KEY] as string[] | undefined) ?? [];
}

async function openInViewer(tabId: number, url: string): Promise<void> {
  if (!isPdf(url) || (await skipped()).includes(url)) return;
  await browser.tabs.update(tabId, { url: `${browser.runtime.getURL(VIEWER)}?file=${encodeURIComponent(url)}` });
}

/**
 * Chrome puts content scripts only into pages loaded after Codio was installed or reloaded. On
 * install and on every reload, put them into the open tabs too, so the EMR page need not be
 * reloaded; the copy from the old build notices the new one and switches itself off.
 */
const PAGE_SCRIPTS: ScriptPublicPath[] = ["/content-scripts/content.js"];
const FRAME_SCRIPTS: ScriptPublicPath[] = ["/content-scripts/filler.js"];
async function injectIntoOpenTabs(): Promise<void> {
  // Pages still loading get the manifest's copy on their own; injecting there too would double it.
  const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"], status: "complete" }).catch(() => []);
  await Promise.all(
    tabs.map(async (t) => {
      if (t.id === undefined) return;
      await browser.scripting.executeScript({ target: { tabId: t.id }, files: PAGE_SCRIPTS }).catch(() => undefined);
      await browser.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: FRAME_SCRIPTS }).catch(() => undefined);
    }),
  );
}

export default defineBackground(() => {
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  // The panel opens a port on load; accepted so the panel can tell it is connected.
  browser.runtime.onConnect.addListener(() => undefined);

  // Any way a PDF tab shows up: navigating to one, loading one, switching to one, or one already
  // open when Codio starts (opened before Codio was installed or reloaded).
  browser.tabs.onUpdated.addListener((tabId, info, tab) => {
    const url = info.url ?? (info.status === "loading" || info.status === "complete" ? tab.url : undefined);
    if (url) void openInViewer(tabId, url);
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    browser.tabs.get(tabId).then((t) => (t.url ? openInViewer(tabId, t.url) : undefined)).catch(() => undefined);
  });
  const sweep = () =>
    browser.tabs.query({}).then((tabs) => tabs.forEach((t) => t.id !== undefined && t.url && void openInViewer(t.id, t.url))).catch(() => undefined);
  browser.runtime.onStartup.addListener(sweep);
  browser.runtime.onInstalled.addListener(() => {
    sweep();
    void injectIntoOpenTabs();
  });

  browser.runtime.onMessage.addListener((message: Message, sender) => {
    switch (message?.type) {
      case "pdf:skip":
        return skipped().then((list) => browser.storage.session.set({ [SKIP_KEY]: [...list, String(message.url)] }));
      case "companion:config":
        // `unreachable` lets the PDF viewer say the service is down instead of showing nothing.
        return companionSettings();
      case "select:code":
        return post("/v1/select/code", { text: message.text ?? "", context: message.context ?? "" });
      case "report:check":
        // The provider said yes on the page; the CDI check reads the whole report it captured.
        return post<{ suggestions: unknown[] }>("/v1/cdi/check-page", { blocks: message.blocks, setting: "unknown" });
      case "report:remember":
        return rememberReport(String(message.key), message.entry).then(() => ({ ok: true }));
      case "report:recall":
        return recallReport(String(message.key));
      case "review:save":
        return saveReview(message.save as ReviewSave).catch((err) => ({ error: String(err) }));
      case "review:feedback": {
        // The same feedback log the panel's thumbs write to.
        const s = message.suggestion as { id: string; block: string; kind: string; title: string; gate: { answer: string }; quotes: unknown[] };
        return post("/v1/feedback", { suggestionId: s.id, vote: message.vote, block: s.block, kind: s.kind, gateAnswer: s.gate.answer, title: s.title, quotes: s.quotes, setting: "unknown" });
      }
      case "review:fix":
        return post("/v1/cdi/fix", { suggestion: message.suggestion, sections: message.sections, setting: "unknown" });
      case "icd:predict":
        return post("/v1/icd/predict", { blocks: message.blocks });
      case "icd:start":
        // ICD coding as a job, so the card can show which step it is on.
        return post("/v1/icd/jobs", { blocks: message.blocks });
      case "icd:status":
        return get(`/v1/icd/jobs/${encodeURIComponent(String(message.id))}`);
      case "codes:start":
        // The report run as a job: CDI, then diagnoses → ICD-10 and procedures → CPT, with its steps.
        return post("/v1/codes/jobs", { blocks: message.blocks });
      case "codes:status":
        return get(`/v1/codes/jobs/${encodeURIComponent(String(message.id))}`);
      case "codes:run":
        return post("/v1/codes/run", { blocks: message.blocks });
      case "cpt:predict":
        return post("/v1/cpt/predict", { blocks: message.blocks });
      case "report:ask":
        return post("/v1/report/ask", { title: message.title, report: message.report, question: message.question, earlier: [] });
      case "ptt:start":
        startRecording(sender.tab?.id);
        return Promise.resolve({ ok: true });
      case "ptt:stop":
        return stopRecording();
      case "ptt:cancel":
        return cancelRecording().then(() => ({ ok: true }));
      default:
        return undefined;
    }
  });
});
