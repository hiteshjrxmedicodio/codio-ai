import type { ReportScrollResult } from "@/utils/messages";
import { readDom } from "./domReader";

const STEP_WAIT_MS = 350;
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

/** Read the whole report: scroll every scrolling area to its end, then read all the text. */
export async function readWholeReport(maxSteps: number): Promise<ReportScrollResult> {
  let steps = 0;
  let reachedEnd = true;
  for (const el of scrollTargets()) {
    const r = await scrollThrough(el, maxSteps);
    steps += r.steps;
    reachedEnd &&= r.reachedEnd;
  }
  const dom = readDom();
  return { ...dom, steps, reachedEnd, pdfUrls: embeddedPdfs() };
}
