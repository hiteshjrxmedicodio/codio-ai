import type { ActionResult } from "@/utils/messages";
import { pageWidth } from "./dock";

/** The model gives positions from 0 to 1000 across the screenshot, which shows the page left of the panel. */
function toViewport(x: number, y: number): { px: number; py: number } {
  return { px: (x / 1000) * pageWidth(), py: (y / 1000) * window.innerHeight };
}

function labelOf(el: Element): string {
  const h = el as HTMLElement;
  return [h.getAttribute("aria-label"), h.getAttribute("title"), (h as HTMLInputElement).value, h.innerText]
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
}

/** The control the click would land on: the nearest clickable ancestor of the hit element. */
function clickable(el: Element): Element {
  return el.closest("button, a, [role=button], [role=link], [role=tab], [role=menuitem], input, select, label, [onclick]") ?? el;
}

export function isBlocked(label: string, blocked: string): boolean {
  return Boolean(blocked) && new RegExp(blocked, "i").test(label);
}

export function clickAt(x: number, y: number, blocked: string): ActionResult {
  const { px, py } = toViewport(x, y);
  const hit = document.elementFromPoint(px, py);
  if (!hit) return { ok: false, detail: "Nothing at that position" };
  const target = clickable(hit);
  const label = labelOf(target);
  if (isBlocked(label, blocked)) {
    return { ok: false, detail: `Refused: the control looks like it changes the record (${label.slice(0, 60)})` };
  }
  return clickElement(target, px, py);
}

/** Dispatch the full pointer sequence some apps listen for, then a native click. */
export function clickElement(target: Element, px: number, py: number): ActionResult {
  const label = labelOf(target);
  const opts = { bubbles: true, cancelable: true, clientX: px, clientY: py, view: window };
  target.dispatchEvent(new PointerEvent("pointerdown", opts));
  target.dispatchEvent(new MouseEvent("mousedown", opts));
  target.dispatchEvent(new PointerEvent("pointerup", opts));
  target.dispatchEvent(new MouseEvent("mouseup", opts));
  (target as HTMLElement).click?.();
  (target as HTMLElement).focus?.();
  return { ok: true, detail: `Clicked ${target.tagName.toLowerCase()} ${label.slice(0, 60)}`.trim() };
}

/** The nearest ancestor that actually scrolls vertically, else the page itself. */
function scrollerAt(px: number, py: number): Element {
  let el: Element | null = document.elementFromPoint(px, py);
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
    el = el.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

export function scrollAt(x: number, y: number, direction: "up" | "down"): ActionResult {
  const { px, py } = toViewport(x, y);
  const el = scrollerAt(px, py);
  const before = el.scrollTop;
  const step = Math.max(200, el.clientHeight * 0.8) * (direction === "down" ? 1 : -1);
  el.scrollBy({ top: step, behavior: "instant" as ScrollBehavior });
  const moved = el.scrollTop !== before;
  return { ok: moved, detail: moved ? `Scrolled ${direction}` : "Already at the end" };
}

export function typeText(text: string): ActionResult {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!el || el === document.body) return { ok: false, detail: "No field is focused. Click the field first." };
  if (el instanceof HTMLInputElement && el.type === "password") return { ok: false, detail: "Refused: password field" };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, detail: "Typed into field" };
  }
  if (el.isContentEditable) {
    document.execCommand("insertText", false, text);
    return { ok: true, detail: "Typed into editable area" };
  }
  return { ok: false, detail: "The focused element does not take text" };
}
