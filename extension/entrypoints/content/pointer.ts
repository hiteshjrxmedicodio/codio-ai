import type { ActionResult } from "@/utils/messages";
import { pageWidth } from "./dock";

/**
 * A Clicky-style pointer: a blue cursor that glides to a spot on the page with a short label,
 * then fades. Lives in a shadow root so the page's styles cannot touch it.
 */
let host: HTMLElement | null = null;
let hideTimer: number | undefined;

const STYLE = `
  :host { all: initial; }
  .wrap { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
          transition: transform 450ms cubic-bezier(.2,.8,.2,1), opacity 300ms; opacity: 0; }
  .dot { width: 18px; height: 18px; border-radius: 50%; background: #00309f; border: 3px solid #fff;
         box-shadow: 0 0 0 4px rgba(0,48,159,.25), 0 2px 8px rgba(0,0,0,.3); transform: translate(-50%,-50%); }
  .ring { position: absolute; left: 0; top: 0; width: 18px; height: 18px; border-radius: 50%;
          border: 2px solid #00309f; transform: translate(-50%,-50%); animation: pulse 1.2s ease-out infinite; }
  .label { position: absolute; left: 16px; top: 10px; background: #03045a; color: #fff; white-space: nowrap;
           font: 600 12px/1.3 system-ui, sans-serif; padding: 4px 8px; border-radius: 6px; max-width: 260px;
           overflow: hidden; text-overflow: ellipsis; }
  @keyframes pulse { from { opacity: .9; width: 18px; height: 18px; } to { opacity: 0; width: 56px; height: 56px; } }
  @media (prefers-reduced-motion: reduce) { .wrap { transition: opacity 200ms; } .ring { animation: none; } }
`;

function ensure(): { wrap: HTMLElement; label: HTMLElement } {
  if (!host || !host.isConnected) {
    host = document.createElement("cdi-assist-pointer");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style><div class="wrap"><div class="ring"></div><div class="dot"></div><div class="label"></div></div>`;
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot as ShadowRoot;
  return { wrap: root.querySelector(".wrap") as HTMLElement, label: root.querySelector(".label") as HTMLElement };
}

export function pointAt(x: number, y: number, label: string): ActionResult {
  const { wrap, label: tag } = ensure();
  const px = (x / 1000) * pageWidth();
  const py = (y / 1000) * innerHeight;
  tag.textContent = label;
  wrap.style.opacity = "1";
  wrap.style.transform = `translate(${px}px, ${py}px)`;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    wrap.style.opacity = "0";
  }, 6000);
  return { ok: true, detail: `Pointed at ${label}` };
}
