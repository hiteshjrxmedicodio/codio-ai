import { describe, expect, it } from "vitest";
import { isHistorySection, withoutHistory } from "../src/core/sections";

describe("history sections are left out of coding and review", () => {
  it("knows the history headings, whole or as a word, in any case", () => {
    for (const h of ["Past Medical History", "PAST SURGICAL HISTORY:", "PMH", "Family History", "Social History (SH)", "History", "Medical History / Allergies", "past_history"]) {
      expect(isHistorySection(h), h).toBe(true);
    }
  });

  it("keeps the encounter's own sections, including ones whose words only resemble a history heading", () => {
    // The HPI is the encounter's own story: coded and reviewed, whatever it is called.
    for (const h of ["History of Present Illness", "HPI", "history_present_illness", "Chief Complaint", "Assessment", "Plan", "Operation", "Findings", "Preoperative Diagnosis", ""]) {
      expect(isHistorySection(h), h).toBe(false);
    }
  });

  it("filters blocks by heading and sections by name", () => {
    const blocks = [{ heading: "Assessment", text: "a" }, { heading: "Past Medical History", text: "b" }, { heading: "Plan", text: "c" }];
    expect(withoutHistory(blocks).map((b) => b.text)).toEqual(["a", "c"]);
    const sections = [{ name: "PMH", text: "x" }, { name: "Plan", text: "y" }];
    expect(withoutHistory(sections).map((s) => s.text)).toEqual(["y"]);
  });
});
