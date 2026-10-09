import { describe, expect, it } from "vitest";
import { runCodeScreen } from "../src/modules/cdi/screen/codeScreen";

const NOW = new Date(2026, 9, 9);
const blocks = (sections: { name: string; text: string }[], setting = "unknown" as const) =>
  runCodeScreen(sections, setting, NOW).map((s) => s.block);

describe("code screen", () => {
  it("flags a template placeholder (K1)", () => {
    expect(blocks([{ name: "physical_exam", text: "Abdomen: *** soft" }])).toContain("K1");
  });

  it("flags a do-not-use abbreviation (K2)", () => {
    expect(blocks([{ name: "plan", text: "Insulin 10 U at bedtime" }])).toContain("K2");
  });

  it("flags a missing signature only when the setting requires sections (K3)", () => {
    const note = [{ name: "assessment", text: "Stable." }];
    expect(blocks(note, "unknown")).not.toContain("K3");
    expect(runCodeScreen(note, "enm", NOW).map((s) => s.block)).toContain("K3");
  });

  it("does not flag a signed note (K3)", () => {
    const note = [{ name: "signature_attestation", text: "Electronically signed by the attending" }];
    expect(runCodeScreen(note, "enm", NOW).map((s) => s.block)).not.toContain("K3");
  });

  it("flags empty required sections (K4)", () => {
    const k4 = runCodeScreen([{ name: "assessment", text: "Stable." }], "enm", NOW).filter((s) => s.block === "K4");
    expect(k4.length).toBeGreaterThan(0);
  });

  it("flags a duplicated paragraph (K5)", () => {
    const para = "Patient reports intermittent symptoms over several weeks with gradual worsening and no clear trigger identified so far today.";
    expect(blocks([{ name: "history_present_illness", text: para }, { name: "assessment", text: para }])).toContain("K5");
  });

  it("flags a future date and ignores a past one (K6)", () => {
    expect(blocks([{ name: "plan", text: "Follow up 12/01/2026" }])).toContain("K6");
    expect(blocks([{ name: "plan", text: "Seen 01/02/2026" }])).not.toContain("K6");
  });

  it("gives each rule finding its configured gate answer", () => {
    const [first] = runCodeScreen([{ name: "plan", text: "Insulin 10 U" }], "unknown", NOW);
    expect(first?.gate.source).toBe("rule");
    expect(first?.gate.answer).toBe("interpretation");
  });
});
