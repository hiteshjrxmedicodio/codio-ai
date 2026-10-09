import type { ReportScrollResult } from "@/utils/messages";
import { readDom } from "./domReader";

const STEP_WAIT_MS = 350;
/** Long enough for a lazy-loading report to start adding to itself once its end comes into view. */
const PROBE_WAIT_MS = 400;
const SETTLE_ROUNDS = 2;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The page itself plus every large inner area that scrolls; a report usually lives in one of them. */
function scrollTargets(): Element[] {
  const page = document.scrollingElement ?? document.documentElement;
  const minArea = innerWidth * innerHeight * 0.25;
  const inner = [...document.querySelectorAll("body *")].filter((el) => {
    if (el.scrollHeight <= el.clientHeight + 40) return false;
    const style = getComputedStyle(el);
    if (!/(auto|scroll)/.test(style.overflowY)) return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height >= minArea;
  });
  return [page, ...inner];
}

/**
 * Does this area load more as it is scrolled? One jump to the bottom and back tells: most reports are
 * already whole in the page, and for those the screen-by-screen walk below (seconds of the page jumping
 * under the provider) is skipped.
 */
async function growsWhenScrolled(el: Element): Promise<boolean> {
  const start = el.scrollTop;
  const height = el.scrollHeight;
  el.scrollTop = el.scrollHeight;
  await wait(PROBE_WAIT_MS);
  const grew = el.scrollHeight > height + 2;
  el.scrollTop = start;
  return grew;
}

/**
 * Scroll one area from top to bottom in screen-sized steps. It stops at the true end: the
 * position no longer moves and the content has stopped growing, so lazy-loaded parts of a
 * report are fetched before it is read. Returns the steps taken and whether the end was reached.
 */
async function scrollThrough(el: Element, maxSteps: number): Promise<{ steps: number; reachedEnd: boolean }> {
  const start = el.scrollTop;
  el.scrollTop = 0;
  await wait(STEP_WAIT_MS);
  let steps = 0;
  let settled = 0;
  while (steps < maxSteps) {
    const before = el.scrollTop;
    const height = el.scrollHeight;
    el.scrollTop = before + Math.max(200, el.clientHeight * 0.9);
    await wait(STEP_WAIT_MS);
    steps++;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const stuck = el.scrollTop === before && el.scrollHeight === height;
    settled = atBottom || stuck ? settled + 1 : 0;
    if (settled >= SETTLE_ROUNDS) break;
  }
  const reachedEnd = settled >= SETTLE_ROUNDS;
  el.scrollTop = start;
  return { steps, reachedEnd };
}

/** PDFs shown inside the page, which the page's own text does not contain. */
function embeddedPdfs(): string[] {
  const urls = [...document.querySelectorAll("embed, object, iframe")]
    .map((el) => el.getAttribute("src") || el.getAttribute("data") || "")
    .filter((src) => /\.pdf($|[?#])/i.test(src) || /application\/pdf/i.test(src));
  return [...new Set(urls.map((u) => new URL(u, location.href).href))];
}

/**
 * Read the whole report: every scrolling area is probed at once, the ones that load more as they are
 * scrolled are walked to their end, then all the text is read.
 */
export async function readWholeReport(maxSteps: number): Promise<ReportScrollResult> {
  let steps = 0;
  let reachedEnd = true;
  const targets = scrollTargets();
  const grows = await Promise.all(targets.map(growsWhenScrolled));
  for (const el of targets.filter((_, i) => grows[i])) {
    const r = await scrollThrough(el, maxSteps);
    steps += r.steps;
    reachedEnd &&= r.reachedEnd;
  }
  const dom = readDom();
  return { ...dom, steps, reachedEnd, pdfUrls: embeddedPdfs() };
}
