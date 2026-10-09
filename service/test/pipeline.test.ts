import { describe, expect, it } from "vitest";
import type { Finding, Suggestion } from "../src/core/types";
import { checkQuotes } from "../src/modules/cdi/pipeline/quoteCheck";
import { mergeDuplicates, rankAndCap } from "../src/modules/cdi/pipeline/rank";

const sections = [
  { name: "history_present_illness", text: "Left knee pain after a fall.\nNo prior injury." },
  { name: "physical_exam", text: "Right knee effusion, tender medial joint line." },
];

const finding = (over: Partial<Finding>): Finding => ({
  id: Math.random().toString(36).slice(2, 8),
  block: "P-CON",
  kind: "contradiction",
  title: "t",
  quotes: [],
  detail: {},
  confidence: 0.8,
  ...over,
});

const suggestion = (answer: Suggestion["gate"]["answer"], confidence = 0.8): Suggestion => ({
  ...finding({ confidence, quotes: [{ section: "s", text: Math.random().toString() }] }),
  gate: { answer, reason: "", confidence: 1, source: "P-GATE" },
});

describe("quote check", () => {
  it("keeps findings whose quotes are in the note, ignoring case and spacing", () => {
    const f = finding({ quotes: [{ section: "physical_exam", text: "right  KNEE effusion" }] });
    expect(checkQuotes([f], sections).kept).toHaveLength(1);
  });

  it("drops a finding with an invented quote", () => {
    const f = finding({ quotes: [{ section: "physical_exam", text: "left knee effusion" }] });
    const r = checkQuotes([f], sections);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]?.reason).toMatch(/not found/);
  });

  it("corrects a quote filed under the wrong section", () => {
    const f = finding({ quotes: [{ section: "physical_exam", text: "No prior injury." }] });
    expect(checkQuotes([f], sections).kept[0]?.quotes[0]?.section).toBe("history_present_illness");
  });

  it("drops a finding with no quotes", () => {
    expect(checkQuotes([finding({})], sections).kept).toHaveLength(0);
  });
});

describe("merge and rank", () => {
  it("merges findings that quote the same text and records both blocks", () => {
    const q = [{ section: "a", text: "Same text" }];
    const merged = mergeDuplicates([finding({ quotes: q, block: "P-CON" }), finding({ quotes: q, block: "P-AMB", confidence: 0.9 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.block).toBe("P-AMB");
    expect(merged[0]?.alsoFoundBy).toEqual(["P-CON"]);
  });

  it("shows only critical answers, coding first, capped", () => {
    const items = [suggestion("interpretation"), suggestion("not_critical"), suggestion("coding"), suggestion("denial"), suggestion("not_real")];
    const { shown, hidden } = rankAndCap(items, { shownAnswers: ["coding", "denial", "interpretation"], maxSuggestions: 2, minConfidence: 0 });
    expect(shown.map((s) => s.gate.answer)).toEqual(["coding", "denial"]);
    expect(hidden).toHaveLength(3);
  });
});
