import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stopping a coding run. A job runs inside its own stop signal (AsyncLocalStorage), so every model call
 * and engine process it starts, however deep, can see that the provider pressed Stop without the signal
 * being threaded through each module. A stopped run makes no new model call and kills its engine process.
 */
export class StoppedError extends Error {
  constructor() {
    super("Stopped by the provider");
    this.name = "StoppedError";
  }
}

const current = new AsyncLocalStorage<AbortSignal>();

/** Run `fn` so that everything it starts sees `signal`. */
export const withStop = <T>(signal: AbortSignal, fn: () => T): T => current.run(signal, fn);

/** The stop signal of the run this code belongs to, if it belongs to one. */
export const stopSignal = (): AbortSignal | undefined => current.getStore();

/** Called before each model call: a stopped run goes no further. */
export function throwIfStopped(): void {
  if (current.getStore()?.aborted) throw new StoppedError();
}
