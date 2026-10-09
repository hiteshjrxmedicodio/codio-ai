import type { Content } from "@google/genai";
import { describe, expect, it } from "vitest";
import { observationParts, trimHistory, type Observation } from "../src/modules/agent/observation";
import { toGate } from "../src/modules/page/pageCheck";

const clinical: Observation = {
  url: "https://emr.example/note/1",
  title: "Progress note",
  gate: { status: "clinical", kind: "enm", setting: "enm" },
  blocks: [{ heading: "Assessment", text: "Stable." }],
  screenshot: "AAAA",
};

describe("privacy gate mapping", () => {
  it("opens for a note kind with enough confidence", () => {
    expect(toGate("operative", 0.9, "openai_decisions")).toMatchObject({ status: "clinical", setting: "operative" });
  });

  it("closes for the not-clinical answer", () => {
    expect(toGate("not_clinical", 0.99, "openai_decisions").status).toBe("not_clinical");
  });

  it("closes when confidence is below the configured minimum", () => {
    const g = toGate("enm", 0.2, "openai_decisions");
    expect(g.status).toBe("not_clinical");
    expect(g.note).toMatch(/low confidence/);
  });

  it("closes for an answer that is not a configured choice", () => {
    expect(toGate("something_else", 0.99, "gemini").status).toBe("not_clinical");
  });
});

describe("observation", () => {
  it("includes page text and the screenshot when the gate is open", () => {
    const parts = observationParts(clinical);
    expect(parts[0]?.text).toContain("Stable.");
    expect(parts.some((p) => p.inlineData)).toBe(true);
  });

  it("sends nothing from the page when the gate is closed, whatever the client sent", () => {
    const parts = observationParts({ ...clinical, gate: { status: "not_clinical", kind: "not_clinical", setting: "none" } });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toContain("NOT CLINICAL");
    expect(parts[0]?.text).not.toContain("Stable.");
  });
});

describe("history trimming", () => {
  const img = (n: string): Content => ({ role: "user", parts: [{ text: n }, { inlineData: { mimeType: "image/jpeg", data: "X" } }] });
  const model: Content = { role: "model", parts: [{ text: "ok" }] };

  it("keeps only the newest screenshot", () => {
    const out = trimHistory([img("a"), model, img("b"), model, img("c")]);
    expect(out.filter((c) => c.parts?.some((p) => p.inlineData))).toHaveLength(1);
    expect(out.at(-1)?.parts?.some((p) => p.inlineData)).toBe(true);
  });

  it("never starts on a model turn or an orphaned function response", () => {
    const orphan: Content = { role: "user", parts: [{ functionResponse: { name: "look", response: {} } }] };
    const out = trimHistory([model, orphan, img("a")]);
    expect(out[0]?.parts?.[0]?.text).toBe("a");
  });
});

describe("attachments", () => {
  const withDoc = { ...clinical, attachments: [{ name: "path_report.pdf", sections: [{ name: "findings", text: "Tubular adenoma." }] }] };

  it("are included when the page gate is open", () => {
    expect(observationParts(withDoc)[0]?.text).toContain("Tubular adenoma.");
  });

  it("are included even when the page gate is closed, but the page is not", () => {
    const parts = observationParts({ ...withDoc, gate: { status: "not_clinical", kind: "not_clinical", setting: "none" } });
    expect(parts[0]?.text).toContain("Tubular adenoma.");
    expect(parts[0]?.text).not.toContain("Stable.");
    expect(parts.some((p) => p.inlineData)).toBe(false);
  });
});
