/**
 * The card stack in the top-right corner, after Clicky's menu-bar panel: compact, rounded, never
 * taking focus, the pill still free to follow the pointer (it only hides while over the stack).
 *
 * Each kind of result has its own card, in a fixed order: CDI (the sections it cleaned), ICD-10
 * codes (permission, then each diagnosis phrase with its code and trail), the CPT pipeline (each
 * procedure and its journey to a code), the documentation review, the final codes, and answers. Every card
 * always shows its header bar; at most one card is open at a time, and an open card's body has a
 * capped height that scrolls, so the stack never fills the screen. Opening a card folds the rest.
 * Folding the open card folds the whole stack into a slim strip on the right edge of the window,
 * which brings the cards back (the last one open) when clicked. A card that updates in the
 * background does not take over the one the provider is reading, and only pings the strip.
 */
import { DOCK_STYLE } from "./dockStyle";

export type CardId = "cdi" | "icd" | "cpt" | "review" | "final" | "answer";
/** The report run's order (CDI, then ICD-10, then the CPT pipeline), then the review and the rest. */
const ORDER: CardId[] = ["cdi", "icd", "cpt", "review", "final", "answer"];
const TAG = "codio-ai-dock";

let host: HTMLElement | null = null;
let stack: HTMLElement | null = null;
let strip: HTMLElement | null = null;
let openId: CardId | null = null;
/** The card to bring back when the strip is clicked. */
let lastOpen: CardId | null = null;

const cardEl = (id: CardId) => stack?.querySelector<HTMLElement>(`.card[data-id="${id}"]`) ?? null;

export const hasCard = (id: CardId) => Boolean(cardEl(id));
export const isDockOpen = () => Boolean(stack?.querySelector(".card"));
const isFolded = () => Boolean(host?.classList.contains("folded"));

/** True when (x, y) is over the stack (or the strip it folded into), so the pill can step out of the way. */
export function overDock(x: number, y: number): boolean {
  if (!isDockOpen()) return false;
  // The cards themselves, not the stack: the stack is padded to leave room for the cards' shadows.
  const boxes = isFolded() ? [strip] : [...(stack?.querySelectorAll<HTMLElement>(".card") ?? [])];
  return boxes.some((el) => {
    const r = el?.getBoundingClientRect();
    return !!r && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
  });
}

/** Open one card and fold the others; `null` folds the whole stack into the edge strip. */
/** Told whenever a different card opens, so the chart can show that card's highlights. */
let openListener: ((id: CardId) => void) | null = null;
export const onCardOpen = (fn: (id: CardId) => void) => void (openListener = fn);

function expand(id: CardId | null): void {
  const changed = openId !== id;
  openId = id;
  if (id) lastOpen = id;
  for (const el of stack?.querySelectorAll<HTMLElement>(".card") ?? []) {
    const open = el.dataset.id === id;
    el.classList.toggle("collapsed", !open);
    el.querySelector(".head")?.setAttribute("aria-expanded", String(open));
  }
  fold(id === null);
  if (changed && id) openListener?.(id);
}

/** The strip stands in for the stack while folded; with several cards behind it, it says how many. */
function fold(folded: boolean): void {
  const n = stack?.querySelectorAll(".card").length ?? 0;
  host?.classList.toggle("folded", folded && n > 0);
  if (strip) {
    const count = strip.querySelector<HTMLElement>(".n")!;
    count.textContent = String(n);
    count.hidden = n < 2;
    strip.setAttribute("aria-label", `Show Codio AI's ${n} card${n === 1 ? "" : "s"}`);
    strip.classList.remove("updated");
  }
}

/** The strip was clicked: the stack comes back with the card the provider last had open. */
function unfold(): void {
  const first = stack?.querySelector<HTMLElement>(".card")?.dataset.id as CardId | undefined;
  expand(lastOpen && hasCard(lastOpen) ? lastOpen : (first ?? null));
}

const STRIP_KEY = "codio-strip-top";
const DRAG_PX = 4;
/** Set when the press on the strip became a drag, so letting go does not also unfold the cards. */
let dragged = false;

/** Keep the strip inside the window, whatever its height. */
function placeStrip(top: number): number {
  const max = innerHeight - (strip?.offsetHeight || 120) - 8;
  const y = Math.round(Math.max(8, Math.min(top, max)));
  host?.style.setProperty("--strip-top", `${y}px`);
  return y;
}

/** The strip slides up and down the right edge; where it was left is kept for the next page. */
function dragStrip(e: PointerEvent): void {
  if (e.button !== 0 || !strip || !host) return;
  const startY = e.clientY;
  const startTop = host.getBoundingClientRect().top;
  let y = startTop;
  dragged = false;
  strip.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    if (!dragged && Math.abs(m.clientY - startY) < DRAG_PX) return;
    dragged = true;
    strip?.classList.add("dragging");
    y = placeStrip(startTop + m.clientY - startY);
  };
  const up = () => {
    strip?.removeEventListener("pointermove", move);
    strip?.removeEventListener("pointerup", up);
    strip?.removeEventListener("pointercancel", up);
    strip?.classList.remove("dragging");
    if (dragged) void browser.storage.local.set({ [STRIP_KEY]: y }).catch(() => undefined);
  };
  strip.addEventListener("pointermove", move);
  strip.addEventListener("pointerup", up);
  strip.addEventListener("pointercancel", up);
}

function onClick(e: MouseEvent, onAction: (e: MouseEvent) => void): void {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>(".card");
  const id = el?.dataset.id as CardId | undefined;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!id) return;
  if (!action && target.closest(".head")) return expand(openId === id ? null : id);
  onAction(e);
}

export function mountDock(onAction: (e: MouseEvent) => void): void {
  if (host?.isConnected) return;
  // A copy of Codio from before a reload leaves its dock in the page; only this copy's dock stays.
  document.querySelectorAll(TAG).forEach((el) => el.remove());
  host = document.createElement(TAG);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${DOCK_STYLE}</style><div class="stack" role="complementary" aria-label="Codio AI"></div>
    <button class="strip" type="button" title="Show the cards, or drag to move along the edge"><span class="dot"></span><span class="vt">Codio AI</span><span class="n"></span></button>`;
  stack = root.querySelector(".stack");
  strip = root.querySelector(".strip");
  strip?.addEventListener("pointerdown", dragStrip);
  strip?.addEventListener("click", () => (dragged ? (dragged = false) : unfold()));
  void browser.storage.local
    .get(STRIP_KEY)
    .then((r) => typeof r[STRIP_KEY] === "number" && placeStrip(r[STRIP_KEY] as number))
    .catch(() => undefined);
  stack?.addEventListener("click", (e) => onClick(e, onAction));
  stack?.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>(".card")?.dataset.id as CardId | undefined;
    if (id && t.closest(".head") && !t.closest("button") && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      expand(openId === id ? null : id);
    }
  });
  (document.documentElement ?? document.body).appendChild(host);
}

export function unmountDock(): void {
  host?.remove();
  host = stack = strip = null;
  openId = lastOpen = null;
}

/**
 * Put `html` (a card from cards.ts: header and body) in the card `id`, adding the card in its
 * place in the order if it is new. `focus` opens it (the provider asked for this); otherwise it
 * opens only when no other card is open, so background updates never take over.
 */
export function setCard(id: CardId, html: string, focus = true): void {
  if (!stack) return;
  let el = cardEl(id);
  const isNew = !el;
  if (!el) {
    el = document.createElement("section");
    el.className = "card collapsed entering";
    el.dataset.id = id;
    const next = ORDER.slice(ORDER.indexOf(id) + 1).map(cardEl).find(Boolean);
    stack.insertBefore(el, next ?? null);
    requestAnimationFrame(() => el?.classList.remove("entering"));
  }
  el.innerHTML = html;
  const head = el.querySelector(".head");
  head?.setAttribute("role", "button");
  head?.setAttribute("tabindex", "0");
  // While folded, only a card the provider asked for brings the stack back; the rest ping the strip.
  if (focus || (openId === null && !isFolded()) || openId === id) expand(id);
  else {
    el.classList.add("collapsed");
    if (!isNew) el.classList.add("updated");
    window.setTimeout(() => el?.classList.remove("updated"), 1600);
    if (isFolded()) {
      fold(true);
      strip?.classList.add("updated");
    }
  }
}

export function removeCard(id: CardId): void {
  cardEl(id)?.remove();
  if (openId === id) openId = null;
  if (lastOpen === id) lastOpen = null;
  fold(isFolded());
}

export const element = () => host;
