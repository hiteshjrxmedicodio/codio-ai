import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { SERVICE_ROOT, getConfig } from "../../core/config";
import { StoppedError, stopSignal } from "../../core/stop";

export interface JevUnit {
  uid: string;
  phrase: string;
  state: { diagnosis: { phrase: string; is_active?: boolean }; statements: Record<string, string> };
}

export interface JevResult {
  uid: string;
  code: string | null;
  description?: string | null;
  verification?: string | null;
  handoff?: { required: boolean; reason: string | null; candidate_codes: string[] } | null;
  error?: string | null;
  trail?: JevTrail;
}

/** How the engine reached a code: the index entries it started from, its route down the tree, the linked categories it also checked, its pick and the check of it. */
export interface JevTrail {
  start: { code: string; term: string; desc: string | null }[];
  steps: (
    | { kind: "candidates"; codes: string[] }
    | { kind: "linked"; reached: string[]; dead: string[] }
    | { kind: "decide"; chose: string | null; chose_desc: string | null; confidence: number | null }
    | { kind: "verify"; code: string | null; result: string | null }
    | { kind: "gemini"; chose: string | null; chose_desc: string | null }
    | { kind: "choice"; level: string; parent: string | null; parent_desc: string | null; chose: string | null; chose_desc: string | null; confidence: number | null; undecided: boolean }
  )[];
  fallback: boolean;
}

/**
 * Step 3: ICD-10-CM codes from the ICD engine, its questions answered by the Decisions API (or Jev).
 * It runs as a Python child process through bridge/jev_bridge.py; the engine folder is never modified.
 */
export function runJev(units: JevUnit[], onUnitDone?: (uid: string, code: string | null, description: string | null) => void): Promise<JevResult[]> {
  const icd = getConfig().icd_pipeline;
  const cfg = { ...icd, jev_path: resolve(SERVICE_ROOT, icd.jev_path) };
  // Without this check a missing engine surfaces as a Python import traceback.
  if (!existsSync(join(cfg.jev_path, "run_icd_walk.py"))) {
    return Promise.reject(new Error(`ICD engine not found at ${cfg.jev_path}. Set icd_pipeline.jev_path in service/config/config.yaml`));
  }
  if (stopSignal()?.aborted) return Promise.reject(new StoppedError());
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.python, [join(SERVICE_ROOT, "bridge", "jev_bridge.py"), "--jev", cfg.jev_path], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    // Stop: the engine process is killed at once, whatever diagnosis it is on.
    const stop = stopSignal();
    const onStop = () => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new StoppedError());
    };
    stop?.addEventListener("abort", onStop, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The ICD engine took too long"));
    }, cfg.timeout_ms);
    child.stdout.on("data", (d) => (out += d));
    let pending = "";
    child.stderr.on("data", (d) => {
      err += d;
      // The bridge writes one "PROGRESS {...}" line per finished diagnosis.
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("PROGRESS ")) continue;
        try {
          const p = JSON.parse(line.slice(9)) as { uid: string; code?: string | null; description?: string | null };
          onUnitDone?.(p.uid, p.code ?? null, p.description ?? null);
        } catch {
          /* a malformed progress line only loses one progress tick */
        }
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      stop?.removeEventListener("abort", onStop);
      try {
        const parsed = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { results?: JevResult[]; error?: string };
        if (parsed.error) reject(new Error(parsed.error));
        else resolve(parsed.results ?? []);
      } catch {
        reject(new Error(`The ICD engine failed: ${err.slice(-300) || "no output"}`));
      }
    });
    child.stdin.end(
      JSON.stringify({
        units,
        provider: cfg.provider,
        decisions_model: cfg.decisions_model,
        decisions_url: `${getConfig().openai.base_url}/decisions`,
        workers: cfg.workers,
        retrieval_limit: cfg.retrieval_limit,
        gemini: cfg.gemini_fallback,
        gemini_model: cfg.gemini_model,
      }),
    );
  });
}
