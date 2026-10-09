import { mapLimit } from "../../core/limit";
import type { Section, Usage } from "../../core/types";
import { runScreenRead, type CapturedBlock } from "./screenRead";
import { runSectionMap } from "./sectionMap";

export interface ReadResult {
  sections: Section[];
  usage: Usage[];
}

/** Page text already split into blocks by the extension → standard sections. */
export async function readFromBlocks(blocks: CapturedBlock[]): Promise<ReadResult> {
  const nonEmpty = blocks.filter((b) => b.text.trim());
  if (!nonEmpty.length) return { sections: [], usage: [] };
  const { sections, usage } = await runSectionMap(nonEmpty);
  return { sections, usage: [usage] };
}

/** Pages that draw their text: transcribe each screenshot (parallel, order kept), then map once. */
export async function readFromScreens(screenshots: string[]): Promise<ReadResult> {
  const reads = await mapLimit(screenshots, 4, (shot) => runScreenRead(shot));
  const mapped = await readFromBlocks(reads.flatMap((r) => r.blocks));
  return { sections: mapped.sections, usage: [...reads.map((r) => r.usage), ...mapped.usage] };
}
