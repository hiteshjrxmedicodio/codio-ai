import { getConfig } from "../../core/config";
import { callBlock } from "../../core/llm/gemini";
import type { Section, Usage } from "../../core/types";
import type { CapturedBlock } from "../reading/screenRead";
import { readFromBlocks } from "../reading/read";

export const BLOCK_ID = "P-READ-FILE";

const SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          text: { type: "string" },
          cut_top: { type: "boolean", description: "Continues from a previous page" },
          cut_bottom: { type: "boolean", description: "Runs onto the next page" },
          has_unreadable: { type: "boolean" },
        },
        required: ["heading", "text", "cut_top", "cut_bottom", "has_unreadable"],
      },
    },
  },
  required: ["blocks"],
};

export interface FileReadResult {
  name: string;
  sections: Section[];
  chars: number;
  usage: Usage[];
}

/** Bytes of a base64 string without decoding it. */
function sizeMb(base64: string): number {
  return (base64.length * 3) / 4 / 1024 / 1024;
}

/**
 * Any attached or fetched document → blocks under the document's own headings. Text files are
 * decoded as they are; PDFs (every page) and images go to Gemini, which reads both natively.
 */
export async function transcribeDocument(name: string, mimeType: string, data: string): Promise<{ blocks: CapturedBlock[]; usage: Usage[] }> {
  const cfg = getConfig().files;
  const mb = sizeMb(data);
  if (mb > cfg.max_mb) throw new Error(`${name} is ${mb.toFixed(1)} MB; the limit is ${cfg.max_mb} MB`);
  if (cfg.text_types.includes(mimeType)) {
    return { blocks: [{ heading: "", text: Buffer.from(data, "base64").toString("utf8") }], usage: [] };
  }
  if (!cfg.model_types.includes(mimeType)) {
    throw new Error(`${name}: this file type isn't supported. Attach a PDF, an image or a text file.`);
  }
  const r = await callBlock<{ blocks: CapturedBlock[] }>({
    blockId: BLOCK_ID,
    parts: [{ image: data, mimeType }, { text: `Transcribe the clinical text of the document named ${name}.` }],
    schema: SCHEMA,
  });
  return { blocks: r.data.blocks, usage: [r.usage] };
}

/** Read one attached document into standard sections. */
export async function readAttachedFile(name: string, mimeType: string, data: string): Promise<FileReadResult> {
  const { blocks, usage } = await transcribeDocument(name, mimeType, data);
  const mapped = await readFromBlocks(blocks);
  if (!mapped.sections.length) throw new Error(`No readable text was found in ${name}`);
  return {
    name,
    sections: mapped.sections,
    chars: mapped.sections.reduce((n, s) => n + s.text.length, 0),
    usage: [...usage, ...mapped.usage],
  };
}
