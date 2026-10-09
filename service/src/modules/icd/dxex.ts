/**
 * Diagnosis extraction (DXEX), ported from the Codio engine's two steps: P-DXEX-EXTRACT (engine P005,
 * the phrases after its rules) then P-DXEX-CLASSIFY (engine P006, reduced to what the filter reads:
 * bucket, confirmed and codeable). As in the engine, both buckets are merged and a config filter
 * (icd_pipeline.diagnosis_filters) decides which diagnoses go on to coding.
 */
import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import type { Usage } from "../../core/types";
import { reportText, type Block, type Diagnosis, type DxParameters, type DxStatus } from "./extract";

export interface DxexPhrase {
  field: string;
  verbatim_span: string;
  extracted_phrase: string;
  anatomical_location: string | null;
  split_origin: "single" | "conjunction_split" | "multi_location_split";
  rationale: string;
}

/** What classification returns: only what the filter reads, with the reasons. */
export interface DxexClassification {
  bucket: "diagnoses" | "ambiguous";
  is_confirmed: boolean;
  confirmed_rationale: string;
  is_codeable: boolean;
  codeable_rationale: string;
}

/** One extracted phrase with its classification; what the filter reads. */
export type DxexDiagnosis = DxexPhrase & DxexClassification;

export interface DxexResult {
  diagnoses: DxexDiagnosis[];
  removed: { extracted_phrase: string; reason: string; rationale: string }[];
}

const s = { type: "string" };
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props) });

const EXTRACT_SCHEMA = obj({
  phrases: {
    type: "array",
    items: obj({
      field: s,
      verbatim_span: s,
      extracted_phrase: s,
      anatomical_location: { anyOf: [s, { type: "null" }] },
      split_origin: { type: "string", enum: ["single", "conjunction_split", "multi_location_split"] },
      rationale: s,
    }),
  },
  removed: { type: "array", items: obj({ extracted_phrase: s, reason: s, rationale: s }) },
});

const CLASSIFY_SCHEMA = obj({
  results: {
    type: "array",
    items: obj({
      phrase: s,
      bucket: { type: "string", enum: ["diagnoses", "ambiguous"] },
      is_confirmed: { type: "boolean" },
      confirmed_rationale: s,
      is_codeable: { type: "boolean" },
      codeable_rationale: s,
    }),
  },
});

/** The report as the extraction step reads it: the CDI-cleaned copy to read, the original to quote from. */
function reportParts(blocks: Block[], cleaned?: Block[]): string {
  const original = reportText(blocks);
  const read = cleaned ? reportText(cleaned) : original;
  return read === original ? `ORIGINAL REPORT\n${original}` : `CLEANED REPORT\n${read}\n\nORIGINAL REPORT\n${original}`;
}

/** The client's coding constraints from config, as the extraction step receives them. */
function constraints(): string {
  const c = getConfig().icd_pipeline.client_constraints;
  const lines = [
    c.never_extract.length ? `Never extract: ${c.never_extract.join("; ")}` : "",
    ...c.distinct.map((pair) => `Distinct conditions, never merged: ${pair.join(" | ")}`),
  ].filter(Boolean);
  return lines.length ? `\n\nCLIENT CODING CONSTRAINTS\n${lines.join("\n")}` : "";
}

/** Step 1 (engine P005) then step 2 (engine P006); a phrase step 2 left out stays out, as in the engine. */
export async function extractDxex(blocks: Block[], cleaned?: Block[]): Promise<{ result: DxexResult; usage: Usage[] }> {
  const report = reportParts(blocks, cleaned);
  const step1 = await callBlock<{ phrases: DxexPhrase[]; removed: DxexResult["removed"] }>({
    blockId: "P-DXEX-EXTRACT",
    parts: [{ text: report + constraints() }],
    schema: EXTRACT_SCHEMA,
  });
  const { phrases, removed } = step1.data;
  if (!phrases.length) return { result: { diagnoses: [], removed }, usage: [step1.usage] };

  const list = phrases.map((p, i) => `${i + 1}. ${p.extracted_phrase} (from ${p.field})`).join("\n");
  const step2 = await callBlock<{ results: (DxexClassification & { phrase: string })[] }>({
    blockId: "P-DXEX-CLASSIFY",
    parts: [{ text: `${report}\n\nPHRASES\n${list}` }],
    schema: CLASSIFY_SCHEMA,
  });
  const byPhrase = new Map(step2.data.results.map((r) => [r.phrase.trim().toLowerCase(), r]));
  const diagnoses = phrases.flatMap((p, i) => {
    const r = byPhrase.get(p.extracted_phrase.trim().toLowerCase()) ?? step2.data.results[i];
    if (!r) return [];
    const { phrase: _phrase, ...classification } = r;
    return [{ ...p, ...classification }];
  });
  return { result: { diagnoses, removed }, usage: [step1.usage, step2.usage] };
}

export type FilterGroup = Record<string, boolean | string>;

/** yes/no strings and booleans compare equal, as the engine's cmn_yn_equal does. */
function same(actual: unknown, want: boolean | string): boolean {
  const norm = (v: unknown) => (v === true || v === "yes" || v === "true" ? "yes" : v === false || v === "no" || v === "false" ? "no" : v);
  return norm(actual) === norm(want);
}

const matches = (dx: object, group: FilterGroup) => Object.entries(group).every(([k, v]) => same((dx as Record<string, unknown>)[k], v));

/**
 * The engine's diagnosis filter: kept when it matches any include group (every pair in that group),
 * or when there are no include groups; then dropped when it matches every pair of any exclude group.
 * Returns the reason when the diagnosis is dropped, null when it goes on to coding.
 */
export function filterReason(dx: DxexDiagnosis, filters: { include: FilterGroup[]; exclude: FilterGroup[] }): string | null {
  if (filters.include.length && !filters.include.some((g) => matches(dx, g))) {
    const failing = Object.entries(filters.include[0] ?? {}).filter(([k, v]) => !same((dx as unknown as Record<string, unknown>)[k], v));
    return `Not coded: ${failing.map(([k]) => `${k.replace(/^is_/, "not ").replace(/_/g, " ")}`).join(", ") || "filtered out"}`;
  }
  const hit = filters.exclude.find((g) => matches(dx, g));
  return hit ? `Not coded: excluded (${Object.entries(hit).map(([k, v]) => `${k}=${String(v)}`).join(", ")})` : null;
}

/** The status codio-ai shows: uncertain for the ambiguous bucket, otherwise current. */
export const statusOf = (dx: DxexDiagnosis): DxStatus => (dx.bucket === "ambiguous" ? "uncertain" : "current");

/** In codio-ai's diagnosis shape: the span quotes the page; the extracted phrase is the cleaned wording. */
export function toDiagnosis(dx: DxexDiagnosis): Diagnosis & { dxex: DxexDiagnosis } {
  return { phrase: dx.extracted_phrase, status: statusOf(dx), quotes: [{ section: dx.field, text: dx.verbatim_span, cleaned: dx.extracted_phrase }], dxex: dx };
}

/** The only coding detail DXEX carries now: the anatomical location stated with the phrase. */
export function detailsOf(dx: DxexDiagnosis): DxParameters {
  return { documented: dx.anatomical_location ? [{ name: "anatomical location", value: dx.anatomical_location, phrase: dx.verbatim_span }] : [], missing: [] };
}
