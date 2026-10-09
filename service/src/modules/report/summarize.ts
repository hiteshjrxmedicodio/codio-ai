import { z } from "zod";
import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import { mapLimit } from "../../core/limit";
import type { Usage } from "../../core/types";
import { transcribeDocument } from "../files/readFile";
import { runScreenRead, type CapturedBlock } from "../reading/screenRead";
import { isIdentifierField, isOnlyRemoved, redactBlocks, redactDeep } from "../../core/privacy/redact";

export const BLOCK_ID = "P-SUMMARIZE";

export const SummarizeBodySchema = z
  .object({
    title: z.string().default(""),
    blocks: z.array(z.object({ heading: z.string(), text: z.string() })).optional(),
    pdf: z.object({ name: z.string(), data: z.string() }).optional(),
    screenshots: z.array(z.string()).optional(),
    coverage: z.object({ reachedEnd: z.boolean(), steps: z.number().int(), method: z.string() }),
  })
  .refine((b) => Boolean(b.blocks?.length || b.pdf || b.screenshots?.length), "Send report text, a PDF or screenshots");

export type SummarizeBody = z.infer<typeof SummarizeBodySchema>;

const SCHEMA = {
  type: "object",
  properties: {
    report_type: { type: "string" },
    overview: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          unlabelled: { type: "boolean" },
          summary: { type: "string" },
          key_details: { type: "array", items: { type: "string" } },
        },
        required: ["name", "unlabelled", "summary", "key_details"],
      },
    },
    empty_fields: { type: "array", items: { type: "string" } },
  },
  required: ["report_type", "overview", "fields", "empty_fields"],
};

export interface ReportSummary {
  report_type: string;
  overview: string;
  fields: { name: string; unlabelled: boolean; summary: string; key_details: string[] }[];
  empty_fields: string[];
}

export interface SummarizeResult extends ReportSummary {
  source: "page" | "pdf" | "screens";
  chars: number;
  /** The report text that was summarised, so follow-up questions are answered from the same text. */
  text: string;
  coverage: SummarizeBody["coverage"];
  usage: Usage[];
}

function reportText(blocks: CapturedBlock[], max: number): string {
  return blocks
    .filter((b) => b.text.trim() || b.heading.trim())
    .map((b) => (b.heading ? `--- ${b.heading}\n${b.text}` : `--- (no heading)\n${b.text}`))
    .join("\n\n")
    .slice(0, max);
}

/** Whatever was captured (page text, a whole PDF, or screenshots) → blocks → field-by-field summary. */
export async function summarizeReport(body: SummarizeBody): Promise<SummarizeResult> {
  const usage: Usage[] = [];
  let blocks: CapturedBlock[] = [];
  let source: SummarizeResult["source"] = "page";

  if (body.pdf) {
    const r = await transcribeDocument(body.pdf.name, "application/pdf", body.pdf.data);
    blocks = r.blocks;
    usage.push(...r.usage);
    source = "pdf";
  } else if (body.blocks?.some((b) => b.text.trim())) {
    blocks = body.blocks;
  } else if (body.screenshots?.length) {
    const reads = await mapLimit(body.screenshots, 4, (s) => runScreenRead(s));
    blocks = reads.flatMap((r) => r.blocks);
    usage.push(...reads.map((r) => r.usage));
    source = "screens";
  }

  // Privacy: identifiers are removed from the report before it is summarised or stored.
  blocks = redactBlocks(blocks);
  const text = reportText(blocks, getConfig().report.max_chars);
  if (!text.trim()) throw new Error("Nothing readable was found in this report");
  const note = body.coverage.reachedEnd
    ? `The whole report was captured (${body.coverage.method}).`
    : `The capture may not have reached the end of the report (${body.coverage.method}).`;

  const { data, usage: u } = await callBlock<ReportSummary>({
    blockId: BLOCK_ID,
    parts: [{ text: `REPORT TITLE: ${body.title || "(unknown)"}\nCAPTURE NOTE: ${note}\n\nREPORT\n${text}` }],
    schema: SCHEMA,
  });
  usage.push(u);
  // Fields that are identifiers (DOB, MRN, address…) or held nothing but identifiers are left out
  // altogether: the provider is never shown that they exist, let alone what they held.
  const clean = redactDeep(data);
  const identifying = (f: ReportSummary["fields"][number]) =>
    isIdentifierField(f.name) || /withheld for privacy/i.test(f.summary) || (f.key_details.length > 0 && f.key_details.every(isOnlyRemoved));
  clean.fields = clean.fields.filter((f) => !identifying(f));
  clean.empty_fields = clean.empty_fields.filter((n) => !isIdentifierField(n));
  return { ...clean, source, chars: text.length, text, coverage: body.coverage, usage };
}
