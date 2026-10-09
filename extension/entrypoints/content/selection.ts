/**
 * Highlight-to-code: highlighting text asks Codio whether it is a diagnosis or a procedure and,
 * if so, the companion turns into the code card in place with its ICD-10-CM or CPT codes. When the
 * text is neither, the card offers a spoken question about it instead, and the highlight is kept
 * for that question until the provider clicks elsewhere. Read-only: it never types or clicks.
 */
import { showAskCard, showCodes, showCodesError, showCodesLoading } from "./codeCard";

const MIN_CHARS = 3;
const MAX_CHARS = 1500;
const CONTEXT_CHARS = 600;
const DEBOUNCE_MS = 350;

let enabled = false;
let timer = 0;
let lastText = "";
let request = 0;

export interface Highlight {
  text: string;
  context: string;
}

/** A highlight with nothing to code, waiting for the provider's spoken question about it. */
let unanswered: Highlight | null = null;

/** The highlight the next spoken question is about, if one is waiting; it is used once. */
export function takeHighlight(): Highlight | null {
  const h = unanswered;
  unanswered = null;
  return h;
}

/** The paragraph around the selection, to settle details like side or approach. */
function contextOf(range: Range): string {
  let node: Node | null = range.commonAncestorContainer;
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
  const block = (node as Element | null)?.closest("p, li, td, section, article, div") as HTMLElement | null;
  return (block?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, CONTEXT_CHARS);
}

async function check(): Promise<void> {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    lastText = "";
    unanswered = null;
    return;
  }
  const anchor = sel.anchorNode?.parentElement;
  if (anchor?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (text.length < MIN_CHARS || text.length > MAX_CHARS || text === lastText) return;
  lastText = text;
  unanswered = null;
  const range = sel.getRangeAt(0);
  const context = contextOf(range);
  showCodesLoading(range.getBoundingClientRect());
  const mine = ++request;
  try {
    const result = (await browser.runtime.sendMessage({ type: "select:code", text, context })) as
      | { kind: string; icd: never[]; cpt: never[] }
      | { error: string };
    if (mine !== request) return;
    if ("error" in result) throw new Error(result.error);
    if (showCodes(result)) return;
    unanswered = { text, context };
    showAskCard(text);
  } catch {
    if (mine === request) showCodesError();
  }
}

function onMouseUp(e: MouseEvent): void {
  if ((e.composedPath() as Element[]).some((el) => el?.tagName === "CODIO-AI" || el?.tagName === "CODIO-AI-DOCK" || el?.tagName === "CODIO-MARKS")) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void check(), DEBOUNCE_MS);
}

export function enableSelection(): void {
  if (enabled) return;
  enabled = true;
  document.addEventListener("mouseup", onMouseUp);
}

export function disableSelection(): void {
  enabled = false;
  document.removeEventListener("mouseup", onMouseUp);
  lastText = "";
}
