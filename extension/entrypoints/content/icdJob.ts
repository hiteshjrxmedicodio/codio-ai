/**
 * Runs the ICD pipeline as a service job and polls it, so the card can show which step coding is on.
 */
import type { CodedDiagnosis, IcdStep } from "./companionUi/icdCards";

export interface IcdResult {
  diagnoses?: CodedDiagnosis[];
  engineError?: string;
}

interface JobStatus {
  step?: IcdStep;
  finished?: boolean;
  result?: IcdResult;
  error?: string;
}

const POLL_MS = 1500;
const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runIcdJob(blocks: unknown, onStep: (s: IcdStep) => void): Promise<IcdResult> {
  const started = await send<{ id?: string; error?: string }>({ type: "icd:start", blocks });
  if (!started.id) throw new Error(started.error ?? "coding didn't start");
  let last = "";
  for (;;) {
    await wait(POLL_MS);
    const s = await send<JobStatus>({ type: "icd:status", id: started.id });
    if (s.error && !s.step) throw new Error(s.error);
    if (s.step) {
      const key = JSON.stringify(s.step);
      if (key !== last) onStep(s.step);
      last = key;
    }
    if (s.finished) {
      if (s.error || !s.result) throw new Error(s.error ?? "no result came back");
      return s.result;
    }
  }
}
