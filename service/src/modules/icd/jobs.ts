import { randomUUID } from "node:crypto";
import type { Block } from "./extract";
import { predictIcd, type IcdStep } from "./pipeline";

interface Job {
  step: IcdStep;
  result?: Awaited<ReturnType<typeof predictIcd>>;
  error?: string;
  finished: boolean;
  at: number;
}

/** Finished jobs are kept long enough for the extension's last poll, then dropped. */
const KEEP_MS = 10 * 60_000;
const jobs = new Map<string, Job>();

function sweep(): void {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.finished && now - j.at > KEEP_MS) jobs.delete(id);
}

/** ICD coding as a background job, so the provider can see which step it is on while it runs. */
export function startIcdJob(blocks: Block[]): string {
  sweep();
  const id = randomUUID();
  const job: Job = { step: { step: "extract", label: "Reading the report" }, finished: false, at: Date.now() };
  jobs.set(id, job);
  predictIcd(blocks, (s) => (job.step = s))
    .then((r) => {
      job.result = r;
      job.step = { step: "done", label: "Done" };
    })
    .catch((err) => (job.error = String(err instanceof Error ? err.message : err)))
    .finally(() => {
      job.finished = true;
      job.at = Date.now();
    });
  return id;
}

export const icdJob = (id: string): Job | undefined => jobs.get(id);
