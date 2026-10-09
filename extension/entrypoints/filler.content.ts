/**
 * Fill mode for a dictated report. While armed, a small Codio tag follows the provider's cursor
 * on the page; clicking into an empty text field asks the panel which dictated section belongs
 * there and types it in, the same way a person would, so the field's own undo and change
 * handling work and the provider can edit it afterwards.
 *
 * It only ever types into the field the provider clicked, never into a field that already has
 * text, and never presses a key or a button: saving and signing stay with the provider.
 * Runs in every frame, because EMRs often draw their forms inside frames.
 */
import { fieldContext, isFillable, isEmpty, typeInto } from "./content/fill";

type Armed = { sections: string[] };

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main() {
    let armed: Armed | null = null;
    let tag: HTMLElement | null = null;
    let text: HTMLElement | null = null;
    let busy = false;

    const STYLE = `
      :host { all: initial; position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; }
      .tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px 4px 6px; border-radius: 999px;
        background: #03045a; color: #fff; font: 600 11.5px/1.2 system-ui, -apple-system, sans-serif;
        box-shadow: 0 4px 14px rgba(3, 4, 90, .25); white-space: nowrap; transform: translate(16px, 18px); }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #5b8cff; }
      .tag.ok .dot { background: #34d399; } .tag.warn .dot { background: #fbbf24; }
    `;

    function show(message: string, tone: "" | "ok" | "warn" = "") {
      if (!tag) {
        tag = document.createElement("codio-fill-cursor");
        const root = tag.attachShadow({ mode: "closed" });
        root.innerHTML = `<style>${STYLE}</style><div class="tag"><span class="dot"></span><span class="text"></span></div>`;
        text = root.querySelector(".text");
        (document.documentElement ?? document.body).appendChild(tag);
        (tag as HTMLElement & { _box?: HTMLElement })._box = root.querySelector(".tag") as HTMLElement;
      }
      if (text) text.textContent = message;
      const box = (tag as HTMLElement & { _box?: HTMLElement })._box;
      if (box) box.className = `tag ${tone}`;
    }

    const IDLE = "Codio: click a field to fill it";
    // Each frame draws its own tag only while the cursor is over it, so frames never show a stray one.
    const follow = (e: MouseEvent) => {
      if (!tag) show(IDLE);
      if (tag) tag.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    const leave = (e: MouseEvent) => {
      if (!e.relatedTarget && !busy) {
        tag?.remove();
        tag = null;
      }
    };

    async function onClick(e: MouseEvent) {
      if (!armed || busy) return;
      const field = (e.target as Element | null)?.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']") as HTMLElement | null;
      if (!field || !isFillable(field)) return;
      if (!isEmpty(field)) {
        show("This field already has text, so I left it", "warn");
        return;
      }
      busy = true;
      show("Finding what goes here…");
      try {
        const ctx = fieldContext(field);
        const r = (await browser.runtime.sendMessage({ type: "fill:match", ...ctx, title: document.title })) as
          | { section: string; title: string; text: string }
          | null
          | undefined;
        if (!r?.text) {
          show("Nothing in the dictation belongs here", "warn");
          return;
        }
        typeInto(field, r.text);
        show(`Filled ${r.title}`, "ok");
        browser.runtime.sendMessage({ type: "fill:done", section: r.section }).catch(() => undefined);
      } catch {
        show("Couldn't reach Codio", "warn");
      } finally {
        busy = false;
        window.setTimeout(() => armed && !busy && tag && show(IDLE), 2500);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && armed) {
        disarm();
        browser.runtime.sendMessage({ type: "fill:stopped" }).catch(() => undefined);
      }
    }

    function arm(next: Armed) {
      armed = next;
      document.addEventListener("mousemove", follow, true);
      document.addEventListener("mouseout", leave, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
    }

    function disarm() {
      armed = null;
      tag?.remove();
      tag = null;
      document.removeEventListener("mousemove", follow, true);
      document.removeEventListener("mouseout", leave, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    }

    browser.runtime.onMessage.addListener((message: { type?: string; sections?: string[] }) => {
      if (message?.type === "fill:arm") {
        arm({ sections: message.sections ?? [] });
        return Promise.resolve({ ok: true });
      }
      if (message?.type === "fill:disarm") {
        disarm();
        return Promise.resolve({ ok: true });
      }
      return undefined;
    });
  },
});
