/**
 * Coding jobs, one per report page, that do not belong to whichever report is on screen. A single-page
 * EMR swaps reports without reloading, so the provider can start one report, open the next and start
 * that too: each job keeps running, and a job that finishes after the provider left saves its own codes
 * (History and this session's copy), so going back to that report shows them at once. Going back while
 * it still runs follows the same job instead of starting another.
 */
import type { CodedDiagnosis, IcdStep } from "./companionUi/icdCards";
import { runIcdJob } from "./icdJob";
import { readRun, type CptCard } from "./reportRun";

export interface CodedReport {
  title: string;
  blocks: { heading: string; text: string }[];
  coverage: { reachedEnd: boolean; steps: number; method: string };
  icd: { diagnoses: CodedDiagnosis[]; engineError?: string };
  /** The procedures' CPT codes from the same run. */
  cpt?: CptCard;
  fingerprint: string;
  recordId?: string;
  ids?: { label: string; value: string }[];
}

interface Running {
  done: Promise<CodedReport>;
  step?: IcdStep;
  listeners: Set<(s: IcdStep) => void>;
}

const running = new Map<string, Running>();
const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;

/** First save of a freshly coded report, made by the job itself so it lands even when the provider has moved on. */
async function save(key: string, r: CodedReport): Promise<CodedReport> {
  const saved = await send<{ id?: string; ids?: CodedReport["ids"] }>({ type: "review:save", save: { title: r.title, blocks: r.blocks, icd: r.icd } }).catch(() => null);
  const out = saved?.id ? { ...r, recordId: saved.id, ids: saved.ids } : r;
  const report = { ...out, checked: false, suggestions: [], sections: [], votes: {}, fixes: {} };
  await send({ type: "report:remember", key, entry: { fingerprint: r.fingerprint, report } }).catch(() => undefined);
  return out;
}

/** Start coding the report saved under `key` (ICD-10 and CPT from one report run). */
export function startCoding(key: string, input: Omit<CodedReport, "icd" | "cpt">): void {
  const job = { listeners: new Set() } as Running;
  // The report run: CDI, then diagnoses → ICD-10 and procedures → CPT, each step reported as it goes.
  job.done = runIcdJob<Parameters<typeof readRun>[0]>(input.blocks, (s) => {
    job.step = s;
    for (const fn of job.listeners) fn(s);
  }, "codes")
    .then((r) => {
      const { icd, cpt } = readRun(r);
      return save(key, { ...input, icd, cpt });
    })
    .finally(() => running.delete(key));
  // Nobody may be following when it fails (the provider moved on); a follower still gets the error.
  job.done.catch(() => undefined);
  running.set(key, job);
}

export const isCoding = (key: string) => running.has(key);

/** Follow the job for `key`: its current step straight away, every later one, then its result. */
export function follow(key: string, onStep: (s: IcdStep) => void): Promise<CodedReport> | null {
  const job = running.get(key);
  if (!job) return null;
  if (job.step) onStep(job.step);
  job.listeners.add(onStep);
  return job.done.finally(() => job.listeners.delete(onStep));
}
