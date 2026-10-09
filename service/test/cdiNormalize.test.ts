import { describe, expect, it } from "vitest";
import { mergeCleaned, trailFor, type CdiChange } from "../src/modules/cdi/normalize/normalize";
import { restoreQuotes } from "../src/modules/cdi/pipeline/preprocess";

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
  const change = (over: Partial<CdiChange>): CdiChange => ({ index: 0, kind: "abbreviation", before: "f/u", after: "follow-up (f/u)", reason: "", affects_coding: false, coding_effect: "", ...over });

  it("keeps only changes in blocks that were actually rewritten, and drops no-op changes", () => {
    const out = trailFor(before, after, [change({}), change({ index: 1, before: "HTN", after: "Hypertension (HTN)" }), change({ after: "f/u" , before: "f/u" }), change({ index: 9 })], [
      { index: 1, text: "HTN", reason: "unclear", affects_coding: true, coding_effect: "" },
      { index: 5, text: "x", reason: "out of range", affects_coding: false, coding_effect: "" },
    ]);
    expect(out.changes).toHaveLength(1);
    expect(out.flags.map((f) => f.index)).toEqual([1]);
  });
});

describe("review quotes back in the page's wording", () => {
  const original = [
    { name: "History", text: "72 y/o RHM with LOC x2 this week." },
    { name: "Assessment", text: "Pt w/ HTN, stable." },
  ];
  const corrections: CdiChange[] = [
    { index: 0, kind: "abbreviation", before: "LOC", after: "loss of consciousness (LOC)", reason: "", affects_coding: false, coding_effect: "" },
    { index: 0, kind: "abbreviation", before: "72 y/o RHM", after: "72-year-old (y/o) right-handed male (RHM)", reason: "", affects_coding: false, coding_effect: "" },
    { index: 1, kind: "abbreviation", before: "HTN", after: "hypertension (HTN)", reason: "", affects_coding: false, coding_effect: "" },
  ];
  const finding = (section: string, text: string) => ({ id: "f", block: "P-INC", kind: "unaddressed" as const, title: "t", quotes: [{ section, text }], detail: {}, confidence: 0.9 });

  it("undoes the section's corrections so the quote matches the page", () => {
    const [f] = restoreQuotes([finding("History", "72-year-old (y/o) right-handed male (RHM) with loss of consciousness (LOC) x2")], original, corrections);
    expect(f?.quotes[0]?.text).toBe("72 y/o RHM with LOC x2");
  });

  it("falls back to every section's corrections when the quote names the wrong section", () => {
    const [f] = restoreQuotes([finding("History", "hypertension (HTN), stable")], original, corrections);
    expect(f?.quotes[0]?.text).toBe("HTN, stable");
  });

  it("leaves a quote that is already on the page, or cannot be restored, as written", () => {
    const out = restoreQuotes([finding("Assessment", "stable"), finding("History", "not anywhere")], original, corrections);
    expect(out.map((f) => f.quotes[0]?.text)).toEqual(["stable", "not anywhere"]);
  });
});
