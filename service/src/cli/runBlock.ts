import "dotenv/config";
import { parseArgs } from "node:util";
import type { CareSetting } from "../core/types";
import { RUNNERS } from "./blockRunners";

const USAGE = `Run one block on its own, for debugging a prompt on a real note.

  pnpm block <BLOCK_ID> [--chart note.txt] [--setting enm] [--image shot.jpg] [--audio clip.webm]
                        [--message "..."] [--finding f.json] [--suggestion s.json]

Blocks: ${Object.keys(RUNNERS).join(", ")}
A chart file is plain text; lines like '=== SECTION: assessment ===' start a section.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      chart: { type: "string" },
      setting: { type: "string" },
      image: { type: "string" },
      audio: { type: "string" },
      message: { type: "string" },
      finding: { type: "string" },
      suggestion: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const id = positionals[0];
  const run = id ? RUNNERS[id] : undefined;
  if (values.help || !run) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const started = Date.now();
  const result = await run({ ...values, setting: values.setting as CareSetting | undefined });
  console.log(JSON.stringify(result, null, 2));
  console.error(`\n${id} finished in ${Date.now() - started} ms`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
