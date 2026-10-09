/**
 * Suggestions over the report: each suggestion's quoted words are highlighted where they appear
 * on the page, and clicking them opens the item. The highlight uses the browser's own text
 * highlight feature, so the page's content is never changed and nothing is drawn over it.
 */
const HIGHLIGHT = "codio-suggestion";
const ACTIVE = "codio-suggestion-active";
const STYLE_ID = "codio-highlight-style";

/** CDI's changes are coloured by how much they matter: red changes the codes, amber needs a check, blue is a writing correction. */
export type Level = "high" | "medium" | "low";
const LEVELS: Level[] = ["high", "medium", "low"];
const levelName = (l: Level) => `codio-cdi-${l}`;

interface Mark {
  index: number;
  range: Range;
  level?: Level;
}

let onPick: ((index: number) => void) | null = null;
/** Every highlighted range (an item can have several), for telling which one a click landed in. */
let hits: Mark[] = [];

/**
 * A plain click on highlighted words opens that item. A click that ends
 * a text selection is left alone, so words can still be highlighted for a spoken question.
 */
function onPageClick(e: MouseEvent): void {
  if (!onPick || !hits.length || e.button !== 0 || !window.getSelection()?.isCollapsed) return;
  const at = document.caretPositionFromPoint?.(e.clientX, e.clientY);
  const node = at?.offsetNode ?? document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startContainer;
  const offset = at?.offset ?? document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startOffset ?? 0;
  if (!node) return;
  const hit = hits.find((m) => {
    try {
      return m.range.isPointInRange(node, offset);
    } catch {
      return false;
    }
  });
  if (hit) onPick(hit.index);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Text nodes of the page in order, with their offsets in one long normalised string. */
function textIndex(): { nodes: { node: Text; start: number; raw: string }[]; text: string } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement;
      if (!el || el.closest("script, style, noscript, codio-ai, codio-ai-dock")) return NodeFilter.FILTER_REJECT;
      return n.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: { node: Text; start: number; raw: string }[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = (n.nodeValue ?? "").replace(/\s+/g, " ");
    nodes.push({ node: n as Text, start: text.length, raw });
    text += raw;
  }
  return { nodes, text: text.toLowerCase() };
}

/** A DOM range covering `quote` on the page, ignoring case and spacing. */
function findRange(quote: string, idx: ReturnType<typeof textIndex>): Range | null {
  const needle = norm(quote);
  if (needle.length < 3) return null;
  const at = idx.text.indexOf(needle);
  if (at < 0) return null;
  const locate = (pos: number) => {
    const hit = idx.nodes.findLast((n) => n.start <= pos) ?? idx.nodes[0];
    return hit ? { node: hit.node, offset: Math.min(pos - hit.start, hit.node.length) } : null;
  };
  const a = locate(at);
  const b = locate(at + needle.length);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/**
 * The highlight look. The style element is rewritten every time, never just reused: a copy of Codio from
 * before a reload left its own in the page (the old orange underline), and the highlights share it by name.
 * The same old copy's margin markers (codio-marks) are removed; this build draws none.
 */
function ensureStyle(): void {
  document.querySelectorAll("codio-marks").forEach((el) => el.remove());
  const style = (document.getElementById(STYLE_ID) as HTMLStyleElement | null) ?? document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT}) { background-color: rgba(251, 191, 36, .42); text-decoration: underline 2px #c2410c; text-underline-offset: 3px; }
    ::highlight(${ACTIVE}) { background-color: rgba(245, 158, 11, .62); text-decoration: underline 2.5px #9a3412; text-underline-offset: 3px; }
    ::highlight(${levelName("high")}) { background-color: rgba(239, 68, 68, .30); text-decoration: underline 2px #b91c1c; text-underline-offset: 3px; }
    ::highlight(${levelName("medium")}) { background-color: rgba(251, 191, 36, .42); text-decoration: underline 2px #c2410c; text-underline-offset: 3px; }
    ::highlight(${levelName("low")}) { background-color: rgba(59, 130, 246, .18); text-decoration: underline 1.5px dotted #1d4ed8; text-underline-offset: 3px; }`;
  if (!style.isConnected) (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Highlight each item's quotes; returns how many items could be placed on the page. With `levels`
 * (CDI's changes), each item is coloured by its level instead of the one amber.
 */
export function annotate(quotesPerSuggestion: string[][], pick: (index: number) => void, levels?: Level[]): number {
  clearAnnotations();
  if (!("highlights" in CSS)) return 0;
  onPick = pick;
  ensureStyle();
  const idx = textIndex();
  quotesPerSuggestion.forEach((quotes, index) => {
    for (const q of quotes) {
      const range = findRange(q, idx);
      if (range) hits.push({ index, range, level: levels?.[index] });
    }
  });
  if (!levels) CSS.highlights.set(HIGHLIGHT, new Highlight(...hits.map((m) => m.range)));
  // Where two levels overlap, the more critical colour shows.
  else
    LEVELS.forEach((l, i) => {
      const h = new Highlight(...hits.filter((m) => m.level === l).map((m) => m.range));
      h.priority = LEVELS.length - i;
      CSS.highlights.set(levelName(l), h);
    });
  document.addEventListener("click", onPageClick, true);
  return new Set(hits.map((m) => m.index)).size;
}

/**
 * Mark the items being looked at: all their words stand out, and the first item's words are scrolled into
 * view. `smooth` false jumps there at once, for a card that is about to be placed beside the words.
 */
export function focusSuggestion(index: number | number[], smooth = true): void {
  const order = Array.isArray(index) ? index : [index];
  const mine = order.flatMap((i) => hits.filter((x) => x.index === i));
  if (!mine.length) return;
  const active = new Highlight(...mine.map((m) => m.range));
  active.priority = 10; // Above every CDI colour, so the words being looked at always stand out.
  CSS.highlights.set(ACTIVE, active);
  (mine[0]?.range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "instant" });
}

/** Where an item's first highlighted words sit on screen, for a card to open beside them. */
export function suggestionRect(index: number): DOMRect | undefined {
  return hits.find((m) => m.index === index)?.range.getBoundingClientRect();
}

export function clearAnnotations(): void {
  hits = [];
  document.removeEventListener("click", onPageClick, true);
  if ("highlights" in CSS) {
    CSS.highlights.delete(HIGHLIGHT);
    CSS.highlights.delete(ACTIVE);
    for (const l of LEVELS) CSS.highlights.delete(levelName(l));
  }
}
