/**
 * The card stack in the top-right corner, after Clicky's menu-bar panel: compact, rounded, never
 * taking focus, the pill still free to follow the pointer (it only hides while over the stack).
 *
 * Each kind of result has its own card, in a fixed order: ICD-10 codes (permission, then each
 * diagnosis phrase with its code and trail), the documentation review, CPT predictions, the final
 * codes, and answers. Every card
 * always shows its header bar; at most one card is open at a time, and an open card's body has a
 * capped height that scrolls, so the stack never fills the screen. Opening a card folds the rest.
 * A card that updates in the background does not take over the one the provider is reading.
 */
import { DOCK_STYLE } from "./dockStyle";

export type CardId = "icd" | "review" | "cpt" | "final" | "answer";
const ORDER: CardId[] = ["icd", "review", "cpt", "final", "answer"];
const TAG = "codio-ai-dock";

let host: HTMLElement | null = null;
let stack: HTMLElement | null = null;
let openId: CardId | null = null;

const cardEl = (id: CardId) => stack?.querySelector<HTMLElement>(`.card[data-id="${id}"]`) ?? null;

export const hasCard = (id: CardId) => Boolean(cardEl(id));
export const isDockOpen = () => Boolean(stack?.querySelector(".card"));

/** True when (x, y) is over the stack, so the pill can step out of the way. */
export function overDock(x: number, y: number): boolean {
  if (!isDockOpen() || !stack) return false;
  const r = stack.getBoundingClientRect();
  return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
}

/** Open one card and fold the others; `null` folds them all. */
function expand(id: CardId | null): void {
  openId = id;
  for (const el of stack?.querySelectorAll<HTMLElement>(".card") ?? []) {
    const open = el.dataset.id === id;
    el.classList.toggle("collapsed", !open);
    el.querySelector(".head")?.setAttribute("aria-expanded", String(open));
  }
}

function onClick(e: MouseEvent, onAction: (e: MouseEvent) => void): void {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>(".card");
  const id = el?.dataset.id as CardId | undefined;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!id) return;
  if (action === "close") return removeCard(id);
  if (!action && target.closest(".head")) return expand(openId === id ? null : id);
  onAction(e);
}

export function mountDock(onAction: (e: MouseEvent) => void): void {
  if (host?.isConnected) return;
  host = document.createElement(TAG);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${DOCK_STYLE}</style><div class="stack" role="complementary" aria-label="Codio AI"></div>`;
  stack = root.querySelector(".stack");
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
  host = stack = null;
  openId = null;
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
  if (focus || openId === null || openId === id) expand(id);
  else {
    el.classList.add("collapsed");
    if (!isNew) el.classList.add("updated");
    window.setTimeout(() => el?.classList.remove("updated"), 1600);
  }
}

export function removeCard(id: CardId): void {
  cardEl(id)?.remove();
  if (openId === id) openId = null;
}

export const element = () => host;
