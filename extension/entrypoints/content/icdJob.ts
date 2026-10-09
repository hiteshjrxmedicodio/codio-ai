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
  result?: T;
  error?: string;
}

const POLL_MS = 1500;
const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `kind` picks the job: icd (ICD only) or codes (the report run: CDI, ICD and CPT). */
export async function runIcdJob<T = IcdResult>(
  blocks: unknown,
  onStep: (s: IcdStep) => void,
  kind: "icd" | "codes" = "icd",
  onPartial: (partial: Record<string, unknown>) => void = () => undefined,
): Promise<T> {
  const started = await send<{ id?: string; error?: string }>({ type: `${kind}:start`, blocks });
  if (!started.id) throw new Error(started.error ?? "coding didn't start");
  let last = "";
  let lastPartial = "{}";
  for (;;) {
    await wait(POLL_MS);
    const s = await send<JobStatus<T>>({ type: `${kind}:status`, id: started.id });
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
