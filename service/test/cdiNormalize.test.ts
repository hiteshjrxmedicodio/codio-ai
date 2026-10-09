import { describe, expect, it } from "vitest";
import { mergeCleaned, trailFor, type CdiChange } from "../src/modules/cdi/normalize/normalize";

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

describe("CDI trail", () => {
  const before = [{ heading: "A", text: "f/u 2 wks" }, { heading: "B", text: "HTN" }];
  const after = [{ heading: "A", text: "follow-up (f/u) 2 weeks (wks)" }, { heading: "B", text: "HTN" }];
  const change = (over: Partial<CdiChange>): CdiChange => ({ index: 0, kind: "abbreviation", before: "f/u", after: "follow-up (f/u)", reason: "", ...over });

  it("keeps only changes in blocks that were actually rewritten, and drops no-op changes", () => {
    const out = trailFor(before, after, [change({}), change({ index: 1, before: "HTN", after: "Hypertension (HTN)" }), change({ after: "f/u" , before: "f/u" }), change({ index: 9 })], [
      { index: 1, text: "HTN", reason: "unclear" },
      { index: 5, text: "x", reason: "out of range" },
    ]);
    expect(out.changes).toHaveLength(1);
    expect(out.flags.map((f) => f.index)).toEqual([1]);
  });
});
