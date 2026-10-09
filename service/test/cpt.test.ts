import { describe, expect, it } from "vitest";
import { proceduresToCode, type Extraction } from "../src/modules/cpt/extract";
import { finalize, type CptCode } from "../src/modules/cpt/pipeline";
import { rerank } from "../src/modules/cpt/rerank";

const proc = (procedure_text: string) => ({ procedure_text, extracted_procedure: procedure_text, laterality: "N/A", approach: "", quantity: "single" });
const code = (over: Partial<CptCode>): CptCode => ({ code: "45378", modifier: "", description: "", confidence: 0.8, reason: "", procedure: "", ...over });

describe("CPT rerank", () => {
  it("lets a lexical match lift a candidate the dense score ranked lower", () => {
    const pool = [
      { code: "45378", descriptor: "colonoscopy diagnostic", score: 0.9 },
      { code: "45385", descriptor: "colonoscopy with removal of polyp by snare technique", score: 0.85 },
    ];
    const out = rerank("colonoscopy snare polyp removal", pool, { denseWeight: 0.3, topK: 2, k1: 1.5, b: 0.75 });
    expect(out.map((c) => c.code)).toEqual(["45385", "45378"]);
  });
});

describe("CPT finalize", () => {
  it("keeps one line per code, preferring a modifier, then higher confidence", () => {
    const out = finalize([code({ confidence: 0.7 }), code({ confidence: 0.9 }), code({ code: "43239", confidence: 0.65 }), code({ code: "43239", modifier: "-53", confidence: 0.6 })], 0, "-53");
    expect(out).toEqual([code({ confidence: 0.9 }), code({ code: "43239", modifier: "-53", confidence: 0.6 })]);
  });

  it("drops codes under the gate except discontinued ones", () => {
    const out = finalize([code({ confidence: 0.4 }), code({ code: "43235", modifier: "-53", confidence: 0.2 })], 0.6, "-53");
    expect(out.map((c) => c.code)).toEqual(["43235"]);
  });
});

describe("procedures to code", () => {
  const x = (status: Extraction["status"]): Extraction => ({ status, attempted_procedure: "Colonoscopy", attempted_reason: "poor prep", procedures: [proc("EGD with biopsy")] });

  it("attempted codes only the discontinued procedure", () => {
    const out = proceduresToCode(x("attempted"));
    expect(out).toHaveLength(1);
    expect(out[0]?.attempted).toBe(true);
  });

  it("mixed puts the discontinued procedure last", () => {
    expect(proceduresToCode(x("mixed")).map((p) => !!p.attempted)).toEqual([false, true]);
  });

  it("no procedure codes nothing", () => {
    expect(proceduresToCode({ ...x("no_procedure"), attempted_procedure: "", procedures: [] })).toEqual([]);
  });
});
