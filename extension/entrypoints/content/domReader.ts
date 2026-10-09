import type { CapturedBlock } from "@/utils/types";
import type { DomReadResult } from "@/utils/messages";

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role=heading],legend,dt,th,label,strong,b";
const SKIP_SELECTOR = "nav,header,footer,aside,script,style,noscript,[role=navigation],[role=banner],[aria-hidden=true]";
const MAX_HEADING_CHARS = 60;

/** Prefer the page's main reading area; fall back to the whole body. */
function readingRoot(doc: Document): HTMLElement {
  return (doc.querySelector("main, [role=main], article") as HTMLElement | null) ?? doc.body;
}

function isVisible(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && (el as HTMLElement).offsetParent !== null;
}

/** Short visible texts that look like headings on this page. */
function headingTexts(root: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const el of root.querySelectorAll(HEADING_SELECTOR)) {
    if (el.closest(SKIP_SELECTOR) || !isVisible(el)) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().replace(/:$/, "");
    if (text && text.length <= MAX_HEADING_CHARS) out.add(text.toLowerCase());
  }
  return out;
}

/**
 * Split the rendered text into blocks at heading lines. innerText follows layout, so line
 * order matches what the provider sees. A line counts as a heading when it matches a heading
 * element's text or is a short line ending in a colon.
 */
function blocksFrom(root: HTMLElement): CapturedBlock[] {
  const headings = headingTexts(root);
  const blocks: CapturedBlock[] = [];
  let current: CapturedBlock = { heading: "", text: "" };
  for (const raw of root.innerText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bare = line.replace(/:$/, "");
    const looksLikeHeading = headings.has(bare.toLowerCase()) || (line.endsWith(":") && line.length <= MAX_HEADING_CHARS);
    if (looksLikeHeading) {
      if (current.text.trim() || current.heading) blocks.push(current);
      current = { heading: bare, text: "" };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.text.trim() || current.heading) blocks.push(current);
  return blocks.map((b) => ({ ...b, text: b.text.trim() })).filter((b) => b.text);
}

/** Same-origin iframes are read too; cross-origin frames are invisible to the DOM path. */
function frameDocuments(doc: Document): Document[] {
  const docs: Document[] = [];
  for (const frame of doc.querySelectorAll("iframe")) {
    try {
      if (frame.contentDocument?.body) docs.push(frame.contentDocument);
    } catch {
      // Cross-origin: the vision path covers it.
    }
  }
  return docs;
}

export function readDom(): DomReadResult {
  const blocks = [document, ...frameDocuments(document)].flatMap((d) => blocksFrom(readingRoot(d)));
  return { blocks, chars: blocks.reduce((n, b) => n + b.text.length, 0) };
}
