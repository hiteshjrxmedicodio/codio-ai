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
  finished?: boolean;
  result?: T;
  error?: string;
}

/** Short, so each code shows in its row soon after it lands; the service is local. */
const POLL_MS = 700;
const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `kind` picks the job: icd (ICD only) or codes (the report run: CDI, ICD and CPT). */
export async function runIcdJob<T = IcdResult>(blocks: unknown, onStep: (s: IcdStep) => void, kind: "icd" | "codes" = "icd"): Promise<T> {
  const started = await send<{ id?: string; error?: string }>({ type: `${kind}:start`, blocks });
  if (!started.id) throw new Error(started.error ?? "coding didn't start");
  let last = "";
  for (;;) {
    await wait(POLL_MS);
    const s = await send<JobStatus<T>>({ type: `${kind}:status`, id: started.id });
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
