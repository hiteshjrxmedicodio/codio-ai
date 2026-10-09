import { describe, expect, it } from "vitest";
import { filterReason, statusOf, type DxexDiagnosis, type FilterGroup } from "../src/modules/icd/dxex";

const dx = (over: Partial<DxexDiagnosis>): DxexDiagnosis => ({
  field: "Post-op Diagnosis", verbatim_span: "Sigmoid polyp", extracted_phrase: "Sigmoid polyp", anatomical_location: "sigmoid colon",
  split_origin: "single", rationale: "", bucket: "diagnoses", is_confirmed: true, confirmed_rationale: "",
  is_codeable: true, codeable_rationale: "", ...over,
});

describe("DXEX filter (Codio engine semantics)", () => {
  const engine = { include: [{ is_confirmed: true, is_codeable: true }], exclude: [] };

  it("keeps confirmed and codeable, and says which check a dropped diagnosis failed", () => {
    expect(filterReason(dx({}), engine)).toBeNull();
    expect(filterReason(dx({ is_codeable: false }), engine)).toBe("Not coded: not codeable");
    expect(filterReason(dx({ is_confirmed: false, is_codeable: false }), engine)).toBe("Not coded: not confirmed, not codeable");
  });

  it("ORs include groups, ANDs pairs within a group, and treats yes/no like true/false", () => {
    const f = { include: [{ is_confirmed: "yes", is_codeable: true }, { bucket: "ambiguous" }] as FilterGroup[], exclude: [] };
    expect(filterReason(dx({}), f)).toBeNull();
    expect(filterReason(dx({ is_codeable: false }), f)).not.toBeNull();
    expect(filterReason(dx({ is_codeable: false, bucket: "ambiguous" }), f)).toBeNull();
  });

  it("drops on an exclude group only when every pair matches; no include groups keeps all", () => {
    const f = { include: [], exclude: [{ is_codeable: false, bucket: "ambiguous" }] };
    expect(filterReason(dx({ is_codeable: false }), f)).toBeNull();
    expect(filterReason(dx({ is_codeable: false, bucket: "ambiguous" }), f)).toMatch(/^Not coded: excluded/);
  });

  it("shows the ambiguous bucket as uncertain", () => {
    expect(statusOf(dx({ bucket: "ambiguous" }))).toBe("uncertain");
    expect(statusOf(dx({}))).toBe("current");
  });
});
