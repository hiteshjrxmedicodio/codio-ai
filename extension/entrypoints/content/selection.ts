/**
 * Highlighted text, kept for a spoken question. Highlighting words on the page does nothing by
 * itself (it never codes them); it only remembers them, so a push-to-talk question that follows is
 * answered about those words and their surrounding text. The memory clears when the highlight goes.
 * Read-only: it never types or clicks.
 */
const MIN_CHARS = 3;
const MAX_CHARS = 1500;
const CONTEXT_CHARS = 600;
const DEBOUNCE_MS = 350;

let enabled = false;
let timer = 0;

export interface Highlight {
  text: string;
  context: string;
}

/** The words highlighted now, if any, waiting for a spoken question about them. */
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

function remember(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    unanswered = null;
    return;
  }
  const anchor = sel.anchorNode?.parentElement;
  if (anchor?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return;
  unanswered = { text, context: contextOf(sel.getRangeAt(0)) };
}

function onMouseUp(e: MouseEvent): void {
  if ((e.composedPath() as Element[]).some((el) => el?.tagName === "CODIO-AI" || el?.tagName === "CODIO-AI-DOCK" || el?.tagName === "CODIO-MARKS")) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(remember, DEBOUNCE_MS);
}

export function enableSelection(): void {
  if (enabled) return;
  enabled = true;
  document.addEventListener("mouseup", onMouseUp);
}

export function disableSelection(): void {
  enabled = false;
  document.removeEventListener("mouseup", onMouseUp);
  window.clearTimeout(timer);
  unanswered = null;
}
