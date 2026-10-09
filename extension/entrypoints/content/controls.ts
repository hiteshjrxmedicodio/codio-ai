import type { ActionResult } from "@/utils/messages";
import type { Control } from "@/utils/types";
import { clickElement, isBlocked } from "./actions";
import { pageWidth } from "./dock";

const CLICKABLE = "a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], [role=treeitem], [role=option], summary, select, input[type=button], input[type=submit], [onclick]";

/** Ids handed to the service last time, so a chosen id can be clicked. Rebuilt on every list. */
let lastListed = new Map<string, Element>();

function labelOf(el: Element): string {
  const h = el as HTMLElement;
  return (h.getAttribute("aria-label") || h.innerText || h.getAttribute("title") || (h as HTMLInputElement).value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function where(rect: DOMRect): string {
  const w = pageWidth();
  const col = rect.left + rect.width / 2 < w / 3 ? "left" : rect.left + rect.width / 2 > (2 * w) / 3 ? "right" : "centre";
  const row = rect.top + rect.height / 2 < innerHeight / 3 ? "top" : rect.top + rect.height / 2 > (2 * innerHeight) / 3 ? "bottom" : "middle";
  return `${row} ${col}`;
}

function visible(el: Element, rect: DOMRect): boolean {
  if (rect.width < 4 || rect.height < 4) return false;
  if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > pageWidth()) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
}

/**
 * Visible controls in the viewport, with record-changing ones removed before they ever leave
 * the page. Their order follows reading order so duplicate labels stay distinguishable.
 */
export function listControls(blocked: string, max: number): Control[] {
  lastListed = new Map();
  const out: Control[] = [];
  const els = [...document.querySelectorAll(CLICKABLE)]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => visible(el, rect))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  for (const { el, rect } of els) {
    const label = labelOf(el);
    if (isBlocked(label, blocked) || el.closest("[aria-hidden=true]")) continue;
    const id = `c${out.length + 1}`;
    lastListed.set(id, el);
    out.push({ id, label, role: el.getAttribute("role") ?? el.tagName.toLowerCase(), where: where(rect) });
    if (out.length >= max) break;
  }
  return out;
}

export function clickControl(id: string): ActionResult {
  const el = lastListed.get(id);
  if (!el || !el.isConnected) return { ok: false, detail: "That control is no longer on the page" };
  el.scrollIntoView({ block: "center", inline: "center" });
  const rect = el.getBoundingClientRect();
  return clickElement(el, rect.left + rect.width / 2, rect.top + rect.height / 2);
}
