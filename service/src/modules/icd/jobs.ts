import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { Block } from "./extract";
import { predictIcd, type IcdStep } from "./pipeline";

interface Job {
  step: IcdStep;
  /** Results of the run's parts as each finishes (the report run: cdi, then icd and cpt), before the whole result. */
  partial: Record<string, unknown>;
  result?: unknown;
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

/** A coding run as a background job, so the provider can see which step it is on while it runs. */
export function startJob(first: IcdStep, run: (onStep: (s: IcdStep) => void, part: (key: string, value: unknown) => void) => Promise<unknown>): string {
  sweep();
  const id = randomUUID();
  const job: Job = { step: first, partial: {}, finished: false, at: Date.now() };
  jobs.set(id, job);
  run(
    (s) => (job.step = s),
    (key, value) => (job.partial[key] = value),
  )
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

export const startIcdJob = (blocks: Block[]): string => startJob({ step: "extract", label: "Reading the report" }, (onStep) => predictIcd(blocks, onStep));

export const icdJob = (id: string): Job | undefined => jobs.get(id);

/** GET /jobs/:id for any job: its current step and, once finished, the result. */
export const jobStatus: RequestHandler = (req, res) => {
  const job = icdJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "That coding job has expired" });
    return;
  }
  res.json({ step: job.step, partial: job.partial, finished: job.finished, result: job.result, error: job.error });
};
