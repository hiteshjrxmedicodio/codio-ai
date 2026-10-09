/**
 * Runs the ICD pipeline as a service job and polls it, so the card can show which step coding is on.
 */
import type { CodedDiagnosis, IcdStep } from "./companionUi/icdCards";

export interface IcdResult {
  diagnoses?: CodedDiagnosis[];
  engineError?: string;
}

interface JobStatus<T> {
  step?: IcdStep;
  /** Each part's result as it finishes (the report run: cdi, then icd and cpt). */
  partial?: Record<string, unknown>;
  finished?: boolean;
  stopped?: boolean;
  result?: T;
  error?: string;
}

/** Short, so each code shows in its row soon after it lands; the service is local. */
const POLL_MS = 700;
const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The provider pressed Stop on a running job. */
export class StoppedError extends Error {
  constructor() {
    super("Coding stopped");
    this.name = "StoppedError";
  }
}

export const isStopped = (err: unknown) => err instanceof StoppedError;

/**
 * `kind` picks the job: icd (ICD only) or codes (the report run: CDI, ICD and CPT). Aborting `signal`
 * stops the job in the service too (its model calls end and its engine process is killed).
 */
export async function runIcdJob<T = IcdResult>(
  blocks: unknown,
  onStep: (s: IcdStep) => void,
  kind: "icd" | "codes" = "icd",
  onPartial: (partial: Record<string, unknown>) => void = () => undefined,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new StoppedError();
  const started = await send<{ id?: string; error?: string }>({ type: `${kind}:start`, blocks });
  if (!started.id) throw new Error(started.error ?? "coding didn't start");
  const stop = () => void send({ type: `${kind}:stop`, id: started.id }).catch(() => undefined);
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  let last = "";
  let lastPartial = "{}";
  for (;;) {
    await wait(POLL_MS);
    if (signal?.aborted) throw new StoppedError();
    const s = await send<JobStatus<T>>({ type: `${kind}:status`, id: started.id });
    if (signal?.aborted || s.stopped) throw new StoppedError();
    if (s.error && !s.step) throw new Error(s.error);
    if (s.step) {
      const key = JSON.stringify(s.step);
      if (key !== last) onStep(s.step);
      last = key;
    }
    const partial = JSON.stringify(s.partial ?? {});
    if (partial !== lastPartial) onPartial(s.partial ?? {});
    lastPartial = partial;
    if (s.finished) {
      if (s.error || !s.result) throw new Error(s.error ?? "no result came back");
      return s.result;
    }
  }
}
