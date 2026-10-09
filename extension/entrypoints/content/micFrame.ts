import type { ActionResult } from "@/utils/messages";

const ID = "codio-mic-frame";

/**
 * A one-pixel frame of the extension's mic page, allowed to use the microphone. Its request
 * makes Chrome show the Allow bubble on this tab, for the extension, without opening anything.
 */
export function openMicFrame(url: string): ActionResult {
  closeMicFrame();
  const frame = document.createElement("iframe");
  frame.id = ID;
  frame.src = url;
  frame.allow = "microphone";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;z-index:-1;";
  document.documentElement.appendChild(frame);
  return { ok: true, detail: "Asking for the microphone" };
}

export function closeMicFrame(): ActionResult {
  document.getElementById(ID)?.remove();
  return { ok: true, detail: "Closed" };
}
