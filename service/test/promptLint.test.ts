import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfig } from "../src/core/config";
import { PROMPT_DIR } from "../src/core/prompts";

const SECTIONS = ["ROLE", "FUNCTION", "INPUT", "BOUNDARIES", "REASONING", "GUARDS", "PRECEDENCE", "OUTPUT"];
const BANNED = ["e.g.", "i.e.", "for example", "for instance", "such as", "like this", "including but not limited to"];

function promptFiles(): string[] {
  return readdirSync(PROMPT_DIR, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".txt"));
}

/** Split a prompt into { HEADER: body } using lines that are exactly a section header. */
function sections(text: string): { order: string[]; body: Record<string, string> } {
  const order: string[] = [];
  const body: Record<string, string> = {};
  let current = "";
  for (const line of text.split("\n")) {
    if (SECTIONS.includes(line.trim())) {
      current = line.trim();
      order.push(current);
      body[current] = "";
    } else if (current) {
      body[current] += `${line}\n`;
    }
  }
  return { order, body };
}

describe("prompt standard (docs/PROMPT_STANDARD.md)", () => {
  const files = promptFiles();

  it("every configured block has a prompt file, and every prompt file is configured", () => {
    const cfg = getConfig();
    const configured = [...Object.values(cfg.blocks), ...Object.values(cfg.decision_blocks)].map((b) => b.prompt).sort();
    expect(files.sort()).toEqual(configured);
  });

  for (const file of files) {
    describe(file, () => {
      const text = readFileSync(join(PROMPT_DIR, file), "utf8");
      const { order, body } = sections(text);

      it("has all eight sections, once each, in order", () => {
        expect(order).toEqual(SECTIONS);
      });

      it("FUNCTION is one sentence starting 'Your only job is to'", () => {
        const fn = (body.FUNCTION ?? "").trim();
        expect(fn.startsWith("Your only job is to")).toBe(true);
        expect(fn.split(/(?<=\.)\s+/).filter(Boolean)).toHaveLength(1);
      });

      it("has no bullet lines", () => {
        expect(text.split("\n").filter((l) => /^\s*[-*•]\s/.test(l))).toEqual([]);
      });

      it("numbers lines only inside REASONING", () => {
        for (const [name, content] of Object.entries(body)) {
          if (name === "REASONING") continue;
          expect(content.split("\n").filter((l) => /^\s*\d+[.)]\s/.test(l)), name).toEqual([]);
        }
      });

      it("has no quoted sample text, examples or placeholders", () => {
        expect(text.includes('"')).toBe(false);
        expect(text.includes("{{")).toBe(false);
        const lower = text.toLowerCase();
        expect(BANNED.filter((b) => lower.includes(b))).toEqual([]);
      });
    });
  }
});
