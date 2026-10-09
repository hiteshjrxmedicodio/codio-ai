import { describe, expect, it } from "vitest";
import { mergeCleaned } from "../src/modules/cdi/normalize/normalize";

describe("CDI merge-back", () => {
  const blocks = [
    { heading: "Assessment", text: "HTN, DM2" },
    { heading: "Plan", text: "f/u 2 wks" },
    { heading: "Empty", text: "" },
  ];

  it("uses the cleaned text by index and keeps the original where the model left a block out or blank", () => {
    const out = mergeCleaned(blocks, [
      { index: 0, text: "Hypertension (HTN)\nType 2 diabetes mellitus (DM2)" },
      { index: 1, text: "  " },
      { index: 7, text: "out of range" },
    ]);
    expect(out.map((b) => b.text)).toEqual(["Hypertension (HTN)\nType 2 diabetes mellitus (DM2)", "f/u 2 wks", ""]);
    expect(out.map((b) => b.heading)).toEqual(["Assessment", "Plan", "Empty"]);
  });
});
