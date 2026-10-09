import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { withStop } from "../../core/stop";
import type { Block } from "./extract";
import { predictIcd, type IcdStep } from "./pipeline";

interface Job {
  step: IcdStep;
  /** Results of the run's parts as each finishes (the report run: cdi, then icd and cpt), before the whole result. */
  partial: Record<string, unknown>;
  result?: unknown;
  error?: string;
  finished: boolean;
  /** The provider pressed Stop: the run is abandoned and anything it still returns is ignored. */
  stopped?: boolean;
  stop: AbortController;
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
  const job: Job = { step: first, partial: {}, finished: false, stop: new AbortController(), at: Date.now() };
  jobs.set(id, job);
  withStop(job.stop.signal, () =>
    run(
      (s) => !job.stopped && (job.step = s),
      (key, value) => !job.stopped && (job.partial[key] = value),
    ),
  )
    .then((r) => {
      if (job.stopped) return;
      job.result = r;
      job.step = { step: "done", label: "Done" };
    })
    .catch((err) => !job.stopped && (job.error = String(err instanceof Error ? err.message : err)))
    .finally(() => {
      if (job.stopped) return;
      job.finished = true;
      job.at = Date.now();
    });
  return id;
}

/** Stop a running job: it finishes at once as stopped, its model calls end and its engine process is killed. */
export function stopJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.finished) return false;
  job.stopped = job.finished = true;
  job.error = "Stopped by the provider";
  job.at = Date.now();
  job.stop.abort();
  return true;
}

/** POST /jobs/:id/stop for any job. Stopping a job that already finished or expired is not an error. */
export const stopJobRoute: RequestHandler = (req, res) => {
  res.json({ stopped: stopJob(String(req.params.id)) });
};

export const startIcdJob = (blocks: Block[]): string => startJob({ step: "extract", label: "Reading the report" }, (onStep) => predictIcd(blocks, onStep));

export const icdJob = (id: string): Job | undefined => jobs.get(id);

/** GET /jobs/:id for any job: its current step and, once finished, the result. */
export const jobStatus: RequestHandler = (req, res) => {
  const job = icdJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "That coding job has expired" });
    return;
  }
  res.json({ step: job.step, partial: job.partial, finished: job.finished, stopped: job.stopped, result: job.result, error: job.error });
};
