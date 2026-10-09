import { getConfig } from "../config";

/**
 * HIPAA minimum necessary. Patient identifiers are removed before any text reaches a model and
 * from anything shown back to the provider. Age, sex/gender and insurance payer/plan are kept.
 * Everything here is deterministic: no model decides what counts as an identifier.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#.]+/g, " ").replace(/\s+/g, " ").trim();

/** Formats that identify a person wherever they appear, labelled or not. */
const PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // email
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, // phone / fax
  /\bhttps?:\/\/\S+/g, // URLs (portal links carry patient ids)
];

interface Rules {
  placeholder: string;
  keep: Set<string>;
  identifiers: Set<string>;
  titles: string[];
}

function rules(): Rules | null {
  const p = getConfig().privacy;
  if (!p.enabled) return null;
  return {
    placeholder: p.placeholder,
    keep: new Set(p.keep_labels.map(norm)),
    identifiers: new Set(p.identifier_labels.map(norm)),
    titles: p.name_titles,
  };
}

/** Does this label name an identifier (and not one of the kept demographics)? */
function isIdentifierLabel(label: string, r: Rules): boolean {
  const l = norm(label);
  if (!l || r.keep.has(l)) return false;
  return r.identifiers.has(l);
}

/**
 * A bare "Patient:" label is ambiguous: it can introduce a name or clinical text ("Patient: 54 yo
 * male"). It counts as an identifier only when the value looks like a name.
 */
function redactsValue(label: string, value: string, r: Rules): boolean {
  if (!isIdentifierLabel(label, r)) return false;
  if (norm(label) !== "patient") return true;
  return /^[A-Z][A-Za-z,.'\- ]{1,40}$/.test(value.trim()) && !/\d/.test(value);
}

const LINE_FIELD = /^(\s*[-*•]?\s*)([A-Za-z][A-Za-z .#/'-]{0,40}?)\s*[:=]\s*(.+)$/;
/** A label and its value on one line, possibly several "Label: value" pairs separated by | or ; or two spaces. */
const INLINE_FIELD = /([A-Za-z][A-Za-z .#/'-]{0,30}?)\s*:\s*([^|;\n]+?)(?=\s{2,}|\s*[|;]|$)/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collect the values of identifier fields, so they can be removed wherever else they appear. */
export function collectIdentifiers(text: string): string[] {
  const r = rules();
  if (!r) return [];
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(INLINE_FIELD)) {
      const [, label = "", value = ""] = m;
      if (!redactsValue(label, value, r)) continue;
      const v = value.trim();
      if (v.length >= 2 && v !== r.placeholder) {
        found.add(v);
        // Each part of a name on its own ("Smith" later in the narrative).
        if (/name|patient|guarantor|contact|kin|mother|father|spouse|guardian|parent|subscriber/i.test(label)) {
          for (const part of v.split(/[\s,]+/)) if (/^[A-Z][a-zA-Z'-]{2,}$/.test(part)) found.add(part);
        }
      }
    }
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/** Remove identifiers from free text. `known` are values already collected from identifier fields. */
export function redactText(text: string, known: string[] = []): string {
  const r = rules();
  if (!r || !text) return text;
  const values = [...new Set([...known, ...collectIdentifiers(text)])];
  let out = text
    .split("\n")
    .map((line) => {
      const m = line.match(LINE_FIELD);
      if (m && redactsValue(m[2] ?? "", m[3] ?? "", r)) return `${m[1]}${m[2]}: ${r.placeholder}`;
      return line.replace(INLINE_FIELD, (whole, label: string, value: string) => (redactsValue(label, value, r) ? `${label}: ${r.placeholder}` : whole));
    })
    .join("\n");
  // A full value matches in any case; a single name part only as capitalised (so "Hope" the name
  // does not remove "hope" the word).
  for (const v of values) out = out.replace(new RegExp(`\\b${escapeRegExp(v)}\\b`, /\s/.test(v) ? "gi" : "g"), r.placeholder);
  if (r.titles.length) {
    const titles = r.titles.map(escapeRegExp).join("|");
    out = out.replace(new RegExp(`\\b(?:${titles})\\.?\\s+[A-Z][a-zA-Z'-]+(?:\\s+[A-Z][a-zA-Z'-]+)?`, "g"), r.placeholder);
  }
  for (const p of PATTERNS) out = out.replace(p, r.placeholder);
  return out;
}

export interface TextBlock {
  heading: string;
  text: string;
}

/**
 * Remove identifiers from a report's blocks. A block whose heading is itself an identifier field
 * loses its content; every block is then scrubbed, including names first seen in another block.
 */
export function redactBlocks<T extends TextBlock>(blocks: T[]): T[] {
  const r = rules();
  if (!r) return blocks;
  const known = new Set<string>();
  // A bare "Patient" block often reads "Name, Name 76 Y, Female": the name goes, age and sex stay.
  const LEADING_NAME = /^\s*([A-Z][A-Za-z,.'\- ]+?)(?=\s*\d)/;
  blocks = blocks.map((b) => {
    if (norm(b.heading) !== "patient") return b;
    const name = b.text.match(LEADING_NAME)?.[1];
    return name ? { ...b, heading: "Patient demographics", text: b.text.replace(name, r.placeholder), _name: name } : b;
  }) as T[];
  for (const b of blocks) {
    const leading = (b as T & { _name?: string })._name;
    if (leading) {
      known.add(leading.trim().replace(/[,\s]+$/, ""));
      for (const part of leading.split(/[\s,]+/)) if (/^[A-Z][a-zA-Z'-]{2,}$/.test(part)) known.add(part);
    }
    if (isIdentifierLabel(b.heading, r) && b.text.trim().length >= 2) {
      known.add(b.text.trim());
      if (/name|patient/i.test(b.heading)) for (const part of b.text.split(/[\s,]+/)) if (/^[A-Z][a-zA-Z'-]{2,}$/.test(part)) known.add(part);
    }
    // The text on its own: prefixing the heading would make it look like the label of the first field.
    for (const v of collectIdentifiers(b.text)) known.add(v);
  }
  const values = [...known].sort((a, b) => b.length - a.length);
  return blocks.map(({ _name: _drop, ...b }: T & { _name?: string }) => ({
    ...b,
    text: isIdentifierLabel(b.heading, r) ? r.placeholder : redactText(b.text, values),
  })) as T[];
}

/** Deep-scrub every string in a value (summaries and answers on their way back to the provider). */
export function redactDeep<T>(value: T, known: string[] = []): T {
  if (typeof value === "string") return redactText(value, known) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, known)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, known)])) as T;
  }
  return value;
}

/** True when a field name is one of the configured identifier labels (and not a kept demographic). */
export function isIdentifierField(name: string): boolean {
  const r = rules();
  return r ? isIdentifierLabel(name, r) : false;
}

/** True when a value holds nothing once identifiers are removed. */
export function isOnlyRemoved(value: string): boolean {
  const r = rules();
  if (!r) return false;
  return !value.split(r.placeholder).join("").replace(/[\s,;:.|/-]+/g, "").trim();
}
