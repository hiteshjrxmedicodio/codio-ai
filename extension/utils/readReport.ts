import { api } from "./api";
import type { ActionResult, ReportScrollResult } from "./messages";
import { activeTab, captureVisible, sendToContent, sleep } from "./tab";
import { openWorkTab, readWorkTab } from "./workTab";
import type { ReportSummary } from "./types";

export interface ReadLimits {
  maxScrollSteps: number;
  maxScreens: number;
  domMinChars: number;
  /** Read a background copy of the report instead of scrolling the provider's own tab. */
  backgroundTab: boolean;
  backgroundLoadSeconds: number;
}

/**
 * Scroll through the report and read it, in a background copy when allowed so the provider's
 * screen stays still. A copy that fails to load, or reads short (lazy parts of a page can wait
 * for it to be on screen), falls back to the provider's tab, which they already agreed to.
 */
async function scrollAndRead(limits: ReadLimits, step: (t: string) => void): Promise<ReportScrollResult> {
  if (limits.backgroundTab) {
    const source = await activeTab();
    let work = null;
    try {
      step("Opening a copy of this report in a tab next to yours, so you can keep working");
      work = await openWorkTab(source, limits.domMinChars, limits.backgroundLoadSeconds);
      step("Scrolling through the copy");
      const page = await readWorkTab(work, limits.maxScrollSteps);
      if (page.chars >= limits.domMinChars && page.reachedEnd) return page;
      step("The copy didn't show the whole report; reading it on your screen instead");
    } catch {
      step("The copy didn't open; reading the report on your screen instead");
    } finally {
      await work?.close();
    }
  }
  step("Scrolling through the report");
  return sendToContent<ReportScrollResult>({ type: "report:read", maxSteps: limits.maxScrollSteps });
}

const isPdfUrl = (url: string) => /\.pdf($|[?#])/i.test(url);

async function fetchPdf(url: string): Promise<{ name: string; data: string }> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Couldn't open the PDF (${res.status})`);
  const blob = await res.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "report.pdf");
  return { name, data };
}

/** Reports drawn as images: screenshot, scroll a screen, repeat until the page stops moving. */
async function captureScreens(maxScreens: number, step: (t: string) => void): Promise<{ shots: string[]; reachedEnd: boolean }> {
  const shots: string[] = [];
  let reachedEnd = false;
  for (let i = 0; i < maxScreens; i++) {
    shots.push(await captureVisible());
    const moved = await sendToContent<ActionResult>({ type: "act:scroll", x: 500, y: 500, direction: "down" });
    if (!moved.ok) {
      reachedEnd = true;
      break;
    }
    await sleep(450);
  }
  return { shots, reachedEnd };
}

/**
 * Read the whole report, not just what is on screen, then summarise it field by field.
 * A PDF tab or an embedded PDF is fetched and read on every page; a web page is scrolled to its
 * true end first; a page drawn as images is screenshotted screen by screen.
 */
export async function summarizeOpenReport(limits: ReadLimits, step: (t: string) => void): Promise<ReportSummary> {
  const tab = await activeTab();
  const url = tab.url ?? "";
  const title = tab.title ?? "";

  if (isPdfUrl(url)) {
    step("Opening the PDF");
    const pdf = await fetchPdf(url);
    step("Reading every page of the PDF");
    return api.summarizeReport({ title, pdf, coverage: { reachedEnd: true, steps: 0, method: "every page of the PDF" } });
  }

  const page = await scrollAndRead(limits, step);
  step(page.reachedEnd ? "Reached the end of the report" : "Stopped before the end: the report kept loading");

  if (page.chars < limits.domMinChars && page.pdfUrls[0]) {
    step("Found a PDF inside the page; reading every page");
    const pdf = await fetchPdf(page.pdfUrls[0]);
    return api.summarizeReport({ title, pdf, coverage: { reachedEnd: true, steps: page.steps, method: "every page of the PDF" } });
  }

  if (page.chars >= limits.domMinChars) {
    step(`Read ${page.blocks.length} parts of the report`);
    return api.summarizeReport({
      title,
      blocks: page.blocks,
      coverage: { reachedEnd: page.reachedEnd, steps: page.steps, method: "the full report" },
    });
  }

  step("The report is drawn as an image; reading it screen by screen");
  const { shots, reachedEnd } = await captureScreens(limits.maxScreens, step);
  return api.summarizeReport({ title, screenshots: shots, coverage: { reachedEnd, steps: shots.length, method: "read screen by screen" } });
}
