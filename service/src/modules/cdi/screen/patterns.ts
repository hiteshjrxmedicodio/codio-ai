import type { ScreenPattern } from "../../../core/config";

export interface CompiledPattern {
  regex: RegExp;
  label: string;
}

export function compile(pattern: ScreenPattern): CompiledPattern {
  const spec = typeof pattern === "string" ? { pattern, flags: "", label: pattern } : pattern;
  const flags = new Set([...(spec.flags ?? ""), "g"]);
  return { regex: new RegExp(spec.pattern, [...flags].join("")), label: spec.label ?? spec.pattern };
}

/** Every match of `pattern` in `text`, with a little context so the quote reads naturally. */
export function matches(text: string, pattern: CompiledPattern, context = 40): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(pattern.regex)) {
    const start = Math.max(0, (m.index ?? 0) - context);
    const end = Math.min(text.length, (m.index ?? 0) + m[0].length + context);
    out.push(text.slice(start, end).trim());
  }
  return out;
}

/** Collapse whitespace and case so near-identical paragraphs compare equal. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

const DATE_PATTERNS: { regex: RegExp; toDate: (m: RegExpMatchArray) => Date | null }[] = [
  {
    regex: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})\b/g,
    toDate: (m) => new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])),
  },
  {
    regex: /\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
    toDate: (m) => new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  },
];

export function findDates(text: string): { raw: string; date: Date }[] {
  const out: { raw: string; date: Date }[] = [];
  for (const { regex, toDate } of DATE_PATTERNS) {
    for (const m of text.matchAll(regex)) {
      const date = toDate(m);
      if (date && !Number.isNaN(date.getTime())) out.push({ raw: m[0], date });
    }
  }
  return out;
}
