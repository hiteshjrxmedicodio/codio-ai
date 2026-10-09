/** Helpers for fill mode (entrypoints/filler.content.ts): which fields qualify, what they are called, how to type. */

const BLOCKED_TYPES = new Set(["password", "hidden", "search", "email", "tel", "url", "number", "date", "time", "datetime-local", "month", "week", "color", "range", "file", "checkbox", "radio", "button", "submit", "reset", "image"]);
const MAX_NEARBY_CHARS = 300;

/** A text field the provider could be writing a note into: visible, editable, not a search box. */
export function isFillable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    if (BLOCKED_TYPES.has(el.type) || el.readOnly || el.disabled) return false;
    return el.getAttribute("role") !== "searchbox" && el.getAttribute("role") !== "combobox";
  }
  return false;
}

export function isEmpty(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return !el.value.trim();
  return !(el.innerText ?? "").trim();
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The field's own name: its label, ARIA name, placeholder or title, in that order. */
function labelOf(el: HTMLElement): string {
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) return clean(Array.from(labels, (l) => l.innerText).join(" "));
  const by = el.getAttribute("aria-labelledby");
  if (by) return clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" "));
  return clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "");
}

/** Text that sits just before the field in the layout, usually its visible heading. */
function nearbyOf(el: HTMLElement): string {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    let prev = node.previousElementSibling;
    while (prev) {
      const text = clean((prev as HTMLElement).innerText);
      if (text) return text.slice(-MAX_NEARBY_CHARS);
      prev = prev.previousElementSibling;
    }
  }
  return "";
}

export function fieldContext(el: HTMLElement): { label: string; nearby: string } {
  return { label: labelOf(el), nearby: nearbyOf(el) };
}

/**
 * Type the text in as the browser's own insert, so frameworks see a real input event and the
 * field's undo works. A one-line input gets the text on one line.
 */
export function typeInto(el: HTMLElement, text: string): void {
  const value = el instanceof HTMLInputElement ? text.replace(/\s*\n+\s*/g, "; ") : text;
  el.focus();
  if (document.execCommand("insertText", false, value)) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.innerText = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
