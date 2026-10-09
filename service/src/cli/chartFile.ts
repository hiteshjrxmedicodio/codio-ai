import { readFileSync } from "node:fs";
import type { Section } from "../core/types";

const HEADER = /^===\s*SECTION:\s*(.+?)\s*===\s*$/;

/**
 * A chart file is plain text. Lines of the form `=== SECTION: name ===` start a section.
 * A file with no section lines becomes one section named `other`.
 */
export function parseChart(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(HEADER);
    if (m) {
      current = { name: m[1] as string, text: "" };
      sections.push(current);
    } else if (current) {
      current.text += `${line}\n`;
    } else if (line.trim()) {
      current = { name: "other", text: `${line}\n` };
      sections.push(current);
    }
  }
  return sections.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
}

export function readChart(path: string): Section[] {
  return parseChart(readFileSync(path, "utf8"));
}

export function readImageBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
