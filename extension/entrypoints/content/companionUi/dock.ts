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
  const el = isFolded() ? strip : stack;
  if (!isDockOpen() || !el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
}

/** Open one card and fold the others; `null` folds the whole stack into the edge strip. */
function expand(id: CardId | null): void {
  openId = id;
  if (id) lastOpen = id;
  for (const el of stack?.querySelectorAll<HTMLElement>(".card") ?? []) {
    const open = el.dataset.id === id;
    el.classList.toggle("collapsed", !open);
    el.querySelector(".head")?.setAttribute("aria-expanded", String(open));
  }
  fold(id === null);
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
    <button class="strip" type="button" title="Show the cards"><span class="dot"></span><span class="vt">Codio AI</span><span class="n"></span></button>`;
  stack = root.querySelector(".stack");
  strip = root.querySelector(".strip");
  strip?.addEventListener("click", unfold);
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
