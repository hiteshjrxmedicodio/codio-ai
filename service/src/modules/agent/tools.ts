import type { FunctionDeclaration } from "@google/genai";

const POSITION = {
  x: { type: "integer", minimum: 0, maximum: 1000, description: "Horizontal position on the latest screenshot, 0-1000 from the left" },
  y: { type: "integer", minimum: 0, maximum: 1000, description: "Vertical position on the latest screenshot, 0-1000 from the top" },
};

/** Tools the extension carries out in the browser. The agent sees a fresh observation after each. */
export const CLIENT_TOOLS = new Set(["point", "click_control", "click", "scroll", "type_text", "wait", "look"]);

/** Tools the service carries out itself. */
export const SERVER_TOOLS = new Set(["run_documentation_check"]);

export const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: "point",
    description: "Show the provider where something is by moving a pointer to it with a short label. Does not click.",
    parametersJsonSchema: {
      type: "object",
      properties: { ...POSITION, label: { type: "string", description: "A few words naming what is there" } },
      required: ["x", "y", "label"],
    },
  },
  {
    name: "click_control",
    description:
      "Preferred way to click. Describe what you want to reach; the page's own visible controls are matched to it and the best one is clicked. Controls that change the record are never offered. Use click with a position only when this reports no match.",
    parametersJsonSchema: {
      type: "object",
      properties: { goal: { type: "string", description: "What the click should reach, in plain words" } },
      required: ["goal"],
    },
  },
  {
    name: "click",
    description: "Click at a position. Use when click_control found no match. Read-only navigation only; never a control that changes the record.",
    parametersJsonSchema: {
      type: "object",
      properties: { ...POSITION, target: { type: "string", description: "What you are clicking" } },
      required: ["x", "y", "target"],
    },
  },
  {
    name: "scroll",
    description: "Scroll the page, or the inner scrollable area under the position, by most of a screen.",
    parametersJsonSchema: {
      type: "object",
      properties: { ...POSITION, direction: { type: "string", enum: ["up", "down"] } },
      required: ["direction"],
    },
  },
  {
    name: "type_text",
    description: "Type into the field that currently has focus. Only for search or filter fields, never credentials.",
    parametersJsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "wait",
    description: "Wait a moment for the page to finish loading, then observe again.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "look",
    description: "Observe the current tab again without acting.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "run_documentation_check",
    description:
      "Check a clinical note for critical documentation problems: the note on the current page, or an attached document when you give its name. Results are shown to the provider as cards.",
    parametersJsonSchema: {
      type: "object",
      properties: { document: { type: "string", description: "Name of an attached document to check. Leave out to check the note on the page." } },
    },
  },
];
