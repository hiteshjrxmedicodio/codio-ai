import { describe, expect, it } from "vitest";
import { isIdentifierField, isOnlyRemoved, redactBlocks, redactDeep, redactText } from "../src/core/privacy/redact";

const R = "[removed]";

describe("privacy redaction", () => {
  it("removes labelled identifiers and keeps age, gender and insurance", () => {
    const out = redactText(
      "Patient Name: John Smith\nDOB: 03/14/1971\nMRN: 0049921\nAge: 54\nGender: Male\nInsurance: Aetna PPO\nMember ID: W123456789\nPhone: (555) 201-3344",
    );
    expect(out).not.toMatch(/John|Smith|1971|0049921|W123456789|201-3344/);
    expect(out).toContain("Age: 54");
    expect(out).toContain("Gender: Male");
    expect(out).toContain("Insurance: Aetna PPO");
  });

  it("removes the patient's name wherever it reappears in the narrative", () => {
    const out = redactText("Name: Maria Lopez\nHPI: Lopez reports chest pain. Mrs. Lopez denies fever.");
    expect(out).not.toMatch(/Maria|Lopez/);
    expect(out).toContain("reports chest pain");
  });

  it("removes unlabelled emails, phone numbers and SSNs but keeps clinical numbers", () => {
    const out = redactText("Call 555-201-3344 or jdoe@mail.com. SSN 123-45-6789. BP 120/80, HR 72, K 3.2.");
    expect(out).not.toMatch(/555-201-3344|jdoe@mail\.com|123-45-6789/);
    expect(out).toContain("BP 120/80, HR 72, K 3.2.");
  });

  it("keeps clinical text after a bare Patient label", () => {
    expect(redactText("Patient: 54 yo male with chest pain")).toContain("54 yo male");
    expect(redactText("Patient: Smith, John")).toBe(`Patient: ${R}`);
  });

  it("does not remove an ordinary word that matches a one-word name part case-insensitively", () => {
    expect(redactText("Name: Hope Carter\nPlan: there is hope for recovery")).toContain("hope for recovery");
  });

  it("clears a block whose heading is an identifier and scrubs names in other blocks", () => {
    const out = redactBlocks([
      { heading: "Patient Name", text: "Ana Ruiz" },
      { heading: "Age", text: "61" },
      { heading: "Assessment", text: "Ruiz has controlled hypertension." },
    ]);
    expect(out[0]?.text).toBe(R);
    expect(out[1]?.text).toBe("61");
    expect(out[2]?.text).not.toContain("Ruiz");
  });

  it("finds a name inside a demographics block and removes it from every other block", () => {
    const out = redactBlocks([
      { heading: "Patient Demographics", text: "Patient Name: Robert Hargrove\nAge: 67\nGender: Male" },
      { heading: "Assessment", text: "Acute bronchitis. Hargrove is advised rest and fluids." },
    ]);
    expect(JSON.stringify(out)).not.toContain("Hargrove");
    expect(out[0]?.text).toContain("Age: 67");
    expect(out[1]?.text).toContain("advised rest and fluids");
  });

  it("scrubs every string in a nested result", () => {
    const out = redactDeep({ fields: [{ summary: "Contact at 555-201-3344", key_details: ["Email a@b.co"] }] });
    expect(JSON.stringify(out)).not.toMatch(/555-201-3344|a@b\.co/);
  });

  it("recognises identifier field names and values that held only identifiers", () => {
    expect(isIdentifierField("DOB")).toBe(true);
    expect(isIdentifierField("MRN")).toBe(true);
    expect(isIdentifierField("Age")).toBe(false);
    expect(isIdentifierField("Insurance")).toBe(false);
    expect(isOnlyRemoved("[removed]")).toBe(true);
    expect(isOnlyRemoved("[removed], [removed]")).toBe(true);
    expect(isOnlyRemoved("67")).toBe(false);
  });

  it("keeps age and sex from a Patient line while removing the name everywhere", () => {
    const out = redactBlocks([
      { heading: "Patient", text: "Whitford, Elaine M 76 Y, Female" },
      { heading: "Operation", text: "Whitford tolerated the procedure." },
    ]);
    expect(out[0]?.text).toContain("76 Y, Female");
    expect(JSON.stringify(out)).not.toMatch(/Whitford|Elaine/);
  });
});
