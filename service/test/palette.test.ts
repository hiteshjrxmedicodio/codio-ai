import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The companion's cards are white with cool greys (6780b89): the earlier cream surface and beige
 * borders read as a grey block over the white EMR pages. An editor holding a stale copy of these
 * styles can write the cream palette back without noticing; this catches it.
 */
const UI = join(__dirname, "..", "..", "extension", "entrypoints", "content", "companionUi");
const CREAM = /#(fffdf8|e6ddcc|faf6ee|f1eadd|f6f1e7|7b7365|a39a8a|d8cfbe|24211c|4a453c|fbf8f2|ece4d4)\b/i;

describe("companion cards stay on the white palette", () => {
  for (const file of readdirSync(UI).filter((f) => f.endsWith(".ts"))) {
    it(`${file} has no cream or beige colour`, () => {
      const hits = readFileSync(join(UI, file), "utf8").split("\n").flatMap((l, i) => (CREAM.test(l) ? [`${i + 1}: ${l.trim().slice(0, 80)}`] : []));
      expect(hits).toEqual([]);
    });
  }
});
