import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The companion's cards use the side panel's beige palette (extension/assets/style.css: --bg #faf6ee,
 * --line #e6ddcc, --text #24211c, --muted #7b7365) with the navy header and blue buttons, as the
 * provider asked. The cool-grey palette of 6780b89 was put back more than once by sessions working at
 * the same time; this fails the suite if any of its colours returns.
 */
const UI = join(__dirname, "..", "..", "extension", "entrypoints", "content", "companionUi");
const COOL_GREY = /#(6b6f80|1f2230|e3e6ef|454a5c|eef0f6|f7f8fb|f4f6fb|d5d9e6)\b|background: #fff(fff)?\b/i;

describe("companion cards stay on the side panel's beige palette", () => {
  for (const file of readdirSync(UI).filter((f) => f.endsWith(".ts"))) {
    it(`${file} has no cool-grey or white surface`, () => {
      const hits = readFileSync(join(UI, file), "utf8").split("\n").flatMap((l, i) => (COOL_GREY.test(l) ? [`${i + 1}: ${l.trim().slice(0, 80)}`] : []));
      expect(hits).toEqual([]);
    });
  }

  it("the card surface is the panel's background", () => {
    expect(readFileSync(join(UI, "dockStyle.ts"), "utf8")).toMatch(/\.card \{[^}]*background: #faf6ee/);
    expect(readFileSync(join(UI, "style.ts"), "utf8")).toMatch(/\.shell\.card \{[^}]*background: #faf6ee/);
  });
});
