/**
 * Suggestions over the report: each suggestion's quoted words are highlighted where they appear
 * on the page, with a numbered marker beside them. The highlight uses the browser's own text
 * highlight feature, so the page's content is never changed; markers live in one overlay layer.
 */
const HIGHLIGHT = "codio-suggestion";
const ACTIVE = "codio-suggestion-active";
const STYLE_ID = "codio-highlight-style";

interface Mark {
  index: number;
  range: Range;
}

let marks: Mark[] = [];
let layer: HTMLElement | null = null;
let badges: HTMLElement | null = null;
let onPick: ((index: number) => void) | null = null;
/** Every highlighted range (an item can have several), for telling which one a click landed in. */
let hits: Mark[] = [];

/**
 * A plain click on highlighted words opens that item, like its numbered marker. A click that ends
 * a text selection is left alone, so highlight-to-code still works on top of a highlight.
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
      if (!el || el.closest("script, style, noscript, codio-ai, codio-ai-dock, codio-marks")) return NodeFilter.FILTER_REJECT;
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

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT}) { background-color: rgba(0, 48, 159, .07); }
    ::highlight(${ACTIVE}) { background-color: rgba(0, 48, 159, .18); }`;
  (document.head ?? document.documentElement).appendChild(style);
}

const MARK_STYLE = `
  :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; }
  .b { position: fixed; width: 16px; height: 16px; border-radius: 50%; background: #fff; color: #00309f; pointer-events: auto;
    font: 700 10px/14px system-ui, sans-serif; text-align: center; cursor: pointer; box-shadow: 0 1px 3px rgba(3,4,90,.18);
    border: 1px solid #c9d3f0; transform: translate(-100%, 1px); transition: transform .15s, background .15s, color .15s; }
  .b:hover, .b.on { background: #03045a; color: #fff; border-color: #03045a; }`;

/** Keep each marker in the margin just left of its highlight; markers that would overlap sit side by side. */
const BADGE = 18;
function placeBadges(): void {
  if (!badges) return;
  const placed: { left: number; top: number }[] = [];
  for (const m of marks) {
    const el = badges.querySelector<HTMLElement>(`[data-i="${m.index}"]`);
    const rect = m.range.getClientRects()[0];
    if (!el) continue;
    const visible = rect && rect.bottom > 0 && rect.top < innerHeight;
    el.style.display = visible ? "block" : "none";
    if (!rect || !visible) continue;
    let left = Math.max(BADGE + 4, rect.left - 4);
    while (placed.some((p) => Math.abs(p.top - rect.top) < BADGE && Math.abs(p.left - left) < BADGE)) left -= BADGE;
    if (left < BADGE) left = rect.left + rect.width + BADGE;
    placed.push({ left, top: rect.top });
    el.style.left = `${left}px`;
    el.style.top = `${rect.top}px`;
  }
}

/** Highlight each suggestion's quotes; returns how many suggestions could be placed on the page. */
export function annotate(quotesPerSuggestion: string[][], pick: (index: number) => void): number {
  clearAnnotations();
  if (!("highlights" in CSS)) return 0;
  onPick = pick;
  ensureStyle();
  const idx = textIndex();
  quotesPerSuggestion.forEach((quotes, index) => {
    for (const q of quotes) {
      const range = findRange(q, idx);
      if (range) marks.push({ index, range });
    }
  });
  CSS.highlights.set(HIGHLIGHT, new Highlight(...marks.map((m) => m.range)));
  hits = [...marks];
  document.addEventListener("click", onPageClick, true);

  layer = document.createElement("codio-marks");
  const root = layer.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${MARK_STYLE}</style><div></div>`;
  badges = root.querySelector("div");
  const first = new Map<number, Mark>();
  for (const m of marks) if (!first.has(m.index)) first.set(m.index, m);
  marks = [...first.values()];
  for (const m of marks) {
    const b = document.createElement("div");
    b.className = "b";
    b.dataset.i = String(m.index);
    b.textContent = String(m.index + 1);
    b.title = "Open in Codio";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick?.(m.index);
    });
    badges?.appendChild(b);
  }
  (document.documentElement ?? document.body).appendChild(layer);
  placeBadges();
  window.addEventListener("scroll", placeBadges, { passive: true, capture: true });
  window.addEventListener("resize", placeBadges);
  return marks.length;
}

/** Bring one suggestion into view and emphasise it. */
export function focusSuggestion(index: number): void {
  const m = marks.find((x) => x.index === index);
  badges?.querySelectorAll(".b").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.i === String(index)));
  if (!m) return;
  CSS.highlights.set(ACTIVE, new Highlight(m.range));
  (m.range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function clearAnnotations(): void {
  hits = [];
  document.removeEventListener("click", onPageClick, true);
  if ("highlights" in CSS) {
    CSS.highlights.delete(HIGHLIGHT);
    CSS.highlights.delete(ACTIVE);
  }
  layer?.remove();
  layer = badges = null;
  marks = [];
  window.removeEventListener("scroll", placeBadges, { capture: true });
  window.removeEventListener("resize", placeBadges);
}
