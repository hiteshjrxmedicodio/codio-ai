import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_ROOT } from "../src/core/config";

/** Project rule: no code file over 400 lines. Split by functionality instead. */
const MAX_LINES = 400;
const REPO = resolve(SERVICE_ROOT, "..");
const ROOTS = ["service/src", "service/test", "extension/entrypoints", "extension/components", "extension/utils"];
const CODE = /\.(ts|tsx|js|jsx|css)$/;

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return CODE.test(name) ? [path] : [];
  });
}

describe(`code files stay at or under ${MAX_LINES} lines`, () => {
  const files = ROOTS.flatMap((r) => walk(join(REPO, r)));

  it("finds code files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("has no file over the limit", () => {
    const over = files
      .map((f) => ({ file: relative(REPO, f), lines: readFileSync(f, "utf8").split("\n").length }))
      .filter((f) => f.lines > MAX_LINES);
    expect(over).toEqual([]);
  });
});
