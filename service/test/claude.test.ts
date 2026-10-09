import { describe, expect, it } from "vitest";
import { strictSchema } from "../src/core/llm/claude";

describe("Claude structured-output schema", () => {
  it("closes every object and drops constraints structured outputs do not support", () => {
    const out = strictSchema({
      type: "object",
      properties: {
        codes: { type: "array", items: { type: "object", properties: { confidence: { type: "number", minimum: 0, maximum: 1 } }, required: ["confidence"] } },
      },
      required: ["codes"],
    }) as Record<string, any>;
    expect(out.additionalProperties).toBe(false);
    const item = out.properties.codes.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.confidence).toEqual({ type: "number" });
    expect(item.required).toEqual(["confidence"]);
  });
});
