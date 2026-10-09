/**
 * Coding jobs, one per report page, that do not belong to whichever report is on screen. A single-page
 * EMR swaps reports without reloading, so the provider can start one report, open the next and start
 * that too: each job keeps running, and a job that finishes after the provider left saves its own codes
 * (History and this session's copy), so going back to that report shows them at once. Going back while
 * it still runs follows the same job instead of starting another.
 */
import type { CardId } from "./companionUi/dock";
import type { CodedDiagnosis } from "./companionUi/icdCards";
import { readRun, runReport, type RunView } from "./reportRun";

export interface CodedReport {
  title: string;
  blocks: { heading: string; text: string }[];
  coverage: { reachedEnd: boolean; steps: number; method: string };
  /** Absent when ICD-10 is turned off for the run (report_run in the service's config). */
  icd?: { diagnoses: CodedDiagnosis[]; engineError?: string };
  /** The same run's CDI (sections it cleaned) and CPT pipeline (procedures and their journeys). */
  run: RunView;
  fingerprint: string;
  recordId?: string;
  ids?: { label: string; value: string }[];
}

/** A card the run drew (CDI loading, a coding step, a part's result), replayed to whoever follows the job. */
type Drawn = (html: string, where: CardId) => void;

interface Running {
  done: Promise<CodedReport>;
  /** The last card drawn in each slot, so a follower arriving late sees where the run is. */
  cards: Map<CardId, string>;
  listeners: Set<Drawn>;
}

const running = new Map<string, Running>();
const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;

/** First save of a freshly coded report, made by the job itself so it lands even when the provider has moved on. */
async function save(key: string, r: CodedReport): Promise<CodedReport> {
  const saved = await send<{ id?: string; ids?: CodedReport["ids"] }>({ type: "review:save", save: { title: r.title, blocks: r.blocks, icd: r.icd, run: r.run } }).catch(() => null);
  const out = saved?.id ? { ...r, recordId: saved.id, ids: saved.ids } : r;
  const report = { ...out, checked: false, suggestions: [], sections: [], votes: {}, fixes: {} };
  await send({ type: "report:remember", key, entry: { fingerprint: r.fingerprint, report } }).catch(() => undefined);
  return out;
}

/** Start coding the report saved under `key`: the report run (CDI, then ICD-10 and CPT). */
export function startCoding(key: string, input: Omit<CodedReport, "icd" | "run">): void {
  const job = { cards: new Map(), listeners: new Set() } as Running;
  // Every card the run draws is kept and fanned out, so the page showing this report (if any) stays in step.
  const draw: Drawn = (html, where) => {
    job.cards.set(where, html);
    for (const fn of job.listeners) fn(html, where);
  };
  job.done = runReport(input.blocks, draw)
    .then((r) => {
      const { icd, run } = readRun(r, input.blocks);
      return save(key, { ...input, icd, run });
    })
    .finally(() => running.delete(key));
  // Nobody may be following when it fails (the provider moved on); a follower still gets the error.
  job.done.catch(() => undefined);
  running.set(key, job);
}

export const isCoding = (key: string) => running.has(key);

/** Follow the job for `key`: the cards it has drawn so far straight away, every later one, then its result. */
export function follow(key: string, onDraw: Drawn): Promise<CodedReport> | null {
  const job = running.get(key);
  if (!job) return null;
  for (const [where, html] of job.cards) onDraw(html, where);
  job.listeners.add(onDraw);
  return job.done.finally(() => job.listeners.delete(onDraw));
}
