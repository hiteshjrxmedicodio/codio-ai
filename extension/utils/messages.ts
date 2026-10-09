import type { CapturedBlock, Control } from "./types";

/** Messages the side panel sends to the content script. */
export type ContentRequest =
  | { type: "ping" }
  | { type: "dom:read" }
  | { type: "controls:list"; blocked: string; max: number }
  | { type: "act:clickControl"; id: string }
  | { type: "act:click"; x: number; y: number; blocked: string }
  | { type: "act:scroll"; x: number; y: number; direction: "up" | "down" }
  | { type: "act:type"; text: string }
  | { type: "act:point"; x: number; y: number; label: string }
  | { type: "mic:frame:open"; url: string }
  | { type: "mic:frame:close" }
  | { type: "report:read"; maxSteps: number }
  | { type: "dock:toggle" }
  | { type: "dock:open" }
  | { type: "dock:close" }
  | { type: "dock:metrics" }
  | { type: "companion:on" }
  | { type: "companion:off" }
  | { type: "companion:mode"; mode: string; text?: string }
  /** Codes for one prediction card in the corner stack; null codes shows it as predicting. */
  | { type: "companion:prediction"; card: "icd" | "cpt" | "final"; codes: { code: string; description: string; confidence: number; reason: string }[] | null; focus?: boolean }
  | { type: "fill:arm" }
  | { type: "fill:disarm" };

/** Shape of the page area left of the docked panel, so screenshots can be cropped to it. */
export interface DockMetrics {
  docked: boolean;
  pageWidth: number;
  viewportWidth: number;
}

export interface ActionResult {
  ok: boolean;
  detail: string;
}

export interface DomReadResult {
  blocks: CapturedBlock[];
  chars: number;
}

/** The whole report after scrolling every area to its end. */
export interface ReportScrollResult extends DomReadResult {
  steps: number;
  reachedEnd: boolean;
  pdfUrls: string[];
}

export interface ControlsResult {
  controls: Control[];
}
