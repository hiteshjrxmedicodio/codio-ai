/**
 * The Codio AI companion's pointer element. It is a pill that glides after the pointer and changes
 * shape, in place, into a card beside a highlight (codes) and back. Report cards (permission,
 * suggestions, summary, answers) live in the separate docked card (dock.ts), so the pill keeps
 * following the pointer while they are open.
 */
import { STYLE } from "./style";

export type PillMode = "idle" | "listening" | "working" | "message";
const PILL_TEXT: Record<PillMode, string> = { idle: "Codio AI", listening: "Listening…", working: "Thinking…", message: "" };
const CARD_WIDTH = 330;
const MORPH_MS = 300;

let host: HTMLElement | null = null;
let shell: HTMLElement | null = null;
let pill: HTMLElement | null = null;
let label: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let carded = false;
let hidden = true;
let target = { x: -100, y: -100 };
let shown = { x: -100, y: -100 };
let frame = 0;
let morphTimer = 0;

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mount(onPanelClick: (e: MouseEvent) => void): void {
  if (host?.isConnected) return;
  host = document.createElement("codio-ai");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="shell hidden"><div class="pill"><span class="dot"></span>
      <svg class="mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
      <span class="label">Codio AI</span></div><div class="panel"></div></div>`;
  shell = root.querySelector(".shell");
  pill = root.querySelector(".pill");
  label = root.querySelector(".label");
  panel = root.querySelector(".panel");
  panel?.addEventListener("click", onPanelClick);
  (document.documentElement ?? document.body).appendChild(host);
}

export function unmount(): void {
  if (frame) cancelAnimationFrame(frame);
  host?.remove();
  host = shell = pill = label = panel = null;
  carded = false;
  hidden = true;
  frame = 0;
  shown = { x: -100, y: -100 };
}

export const element = () => host;
export const isCard = () => carded;

/**
 * pointer: open where the pill is (codes for a highlight). dock: settle against the right edge, clear
 * of the report's text, so suggestions sit over the report without covering what they point at.
 */
export type Placement = "pointer" | "dock";

/** Where a card of this height fits on screen. */
const MARGIN = 10;

function fit(height: number, placement: Placement, anchor?: DOMRect): { x: number; y: number } {
  const maxX = innerWidth - CARD_WIDTH - MARGIN;
  if (placement === "dock" || (shown.x < 0 && !anchor)) return { x: Math.max(MARGIN, innerWidth - CARD_WIDTH - 26), y: MARGIN };
  // Next to the highlight: below it when it fits, otherwise above it, never off screen.
  const ref = anchor ?? new DOMRect(shown.x, shown.y, 0, 0);
  const x = Math.min(Math.max(MARGIN, ref.left), maxX);
  const below = ref.bottom + 8;
  const above = ref.top - 8 - height;
  const y = below + height <= innerHeight - MARGIN ? below : above >= MARGIN ? above : Math.max(MARGIN, innerHeight - height - MARGIN);
  return { x, y };
}

function paint(): void {
  if (host) host.style.transform = `translate(${shown.x}px, ${shown.y}px)`;
}

/** Ease towards the pointer while a pill; a card stays where it opened. */
function tick(): void {
  const ease = reduceMotion() ? 1 : 0.28;
  shown = { x: shown.x + (target.x - shown.x) * ease, y: shown.y + (target.y - shown.y) * ease };
  paint();
  frame = Math.abs(target.x - shown.x) + Math.abs(target.y - shown.y) > 0.5 ? requestAnimationFrame(tick) : 0;
}

export function follow(x: number, y: number): void {
  if (carded) return;
  target = { x, y };
  if (shown.x < 0) {
    shown = { ...target };
    paint();
  }
  if (!frame) frame = requestAnimationFrame(tick);
}

export function setVisible(visible: boolean): void {
  hidden = !visible;
  shell?.classList.toggle("hidden", hidden && !carded);
}

export function setPill(mode: PillMode, text = ""): void {
  if (!shell || !label) return;
  shell.classList.remove("listening", "working", "message");
  if (mode !== "idle") shell.classList.add(mode);
  label.textContent = text || PILL_TEXT[mode];
  if (mode !== "idle") {
    if (shown.x < 0) {
      shown = target = { x: innerWidth / 2, y: innerHeight / 2 };
      paint();
    }
    shell.classList.remove("hidden");
  }
}

/** Grow the pill into a card holding `html`, in place. Returns the card body for wiring buttons. */
export function openCard(html: string, placement: Placement = "pointer", anchor?: DOMRect): HTMLElement | null {
  if (!shell || !panel || !pill) return null;
  window.clearTimeout(morphTimer);
  const from = shell.getBoundingClientRect();
  panel.innerHTML = html;
  // Opening a collapsed section grows the card down to the screen's edge, then it scrolls inside.
  panel.querySelectorAll("details").forEach((d) =>
    d.addEventListener("toggle", () => {
      if (!panel) return;
      panel.style.maxHeight = "none";
      const top = panel.getBoundingClientRect().top;
      panel.style.maxHeight = `${Math.min(panel.scrollHeight, innerHeight - top - MARGIN)}px`;
    }),
  );
  // Measure the card's natural size without showing it.
  shell.classList.add("measuring");
  // Never taller than the screen; anything more scrolls inside the card.
  const height = Math.min(panel.scrollHeight, innerHeight - 2 * MARGIN);
  panel.style.maxHeight = `${height}px`;
  shell.classList.remove("measuring");
  if (!carded) {
    shell.style.width = `${from.width}px`;
    shell.style.height = `${from.height}px`;
    void shell.offsetWidth;
  }
  carded = true;
  shell.classList.remove("hidden", "listening", "working", "message");
  shell.classList.add("card");
  shell.style.width = `${CARD_WIDTH}px`;
  shell.style.height = `${height}px`;
  const spot = fit(height, placement, anchor);
  shown = target = spot;
  host?.classList.add("moving");
  paint();
  morphTimer = window.setTimeout(() => {
    host?.classList.remove("moving");
    if (shell) shell.style.height = "auto";
  }, MORPH_MS);
  return panel;
}

/** Shrink the card back into the pill, which then follows the pointer again. */
export function closeCard(): void {
  if (!shell || !carded || !pill) return;
  window.clearTimeout(morphTimer);
  shell.style.height = `${shell.getBoundingClientRect().height}px`;
  void shell.offsetWidth;
  shell.classList.remove("card");
  const p = pill.getBoundingClientRect();
  shell.style.width = `${p.width}px`;
  shell.style.height = `${p.height}px`;
  carded = false;
  morphTimer = window.setTimeout(() => {
    if (!shell || !panel) return;
    shell.style.width = shell.style.height = "";
    panel.innerHTML = "";
    shell.classList.toggle("hidden", hidden);
  }, MORPH_MS);
}
