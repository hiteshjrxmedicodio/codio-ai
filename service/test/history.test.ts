import { describe, expect, it } from "vitest";
import { asHistoryPhrase, historyCandidates, namesCondition, pickHistory } from "../src/modules/icd/history";

const r = (uid: string, code: string | null, description: string | null = null) => ({ uid, code, description });

describe("coding a historical diagnosis", () => {
  it("prefixes a phrase that does not already say history", () => {
    expect(asHistoryPhrase("colon polyps")).toBe("personal history of colon polyps");
    expect(asHistoryPhrase("prior myocardial infarction")).toBe("prior myocardial infarction");
    expect(asHistoryPhrase("s/p appendectomy")).toBe("s/p appendectomy");
  });

  it("matches a description to the phrase by content words, lightly stemmed", () => {
    expect(namesCondition("Personal history of colonic polyps", "colon polyps")).toBe(true);
    expect(namesCondition("Personal history of malignant neoplasm of breast", "breast cancer")).toBe(true);
    expect(namesCondition("Personal history of peptic ulcer disease", "colon polyps")).toBe(false);
  });

  it("finds the history-form codes naming a condition in the CMS tabular", () => {
    expect(historyCandidates("breast cancer", 8).map((c) => c.code)).toContain("Z85.3");
    expect(historyCandidates("colon polyps", 8)[0]?.code.startsWith("Z86.010")).toBe(true);
    expect(historyCandidates("myocardial infarction", 8).map((c) => c.code)).toContain("I25.2");
    expect(historyCandidates("xyzzy", 8)).toEqual([]);
    // The patient's own past only: family history never competes.
    expect(historyCandidates("colon polyps", 8).some((c) => c.description.startsWith("Family history"))).toBe(false);
  });

  it("takes the old / sequela form from the condition's own chapter first", () => {
    const pick = pickHistory(r("dx0", "I25.2", "Old myocardial infarction"), r("dx0h", "Z86.79", "Personal history of other diseases of the circulatory system"), "myocardial infarction");
    expect(pick.code).toBe("I25.2");
  });

  it("takes the personal-history code when the walk as written coded it as if current", () => {
    const pick = pickHistory(r("dx1", "C50.919", "Malignant neoplasm of unspecified site of unspecified female breast"), r("dx1h", "Z85.3", "Personal history of malignant neoplasm of breast"), "breast cancer");
    expect(pick.code).toBe("Z85.3");
    expect(pick.uid).toBe("dx1");
  });

  it("hands over with both candidates when neither walk names the condition as history", () => {
    const pick = pickHistory(r("dx2", "K63.5", "Polyp of colon"), r("dx2h", "Z87.11", "Personal history of peptic ulcer disease"), "colon polyps");
    expect(pick.code).toBeNull();
    expect(pick.handoff?.candidate_codes).toEqual(["K63.5", "Z87.11"]);
  });
});
