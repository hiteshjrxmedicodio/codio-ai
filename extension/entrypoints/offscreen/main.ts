/** Hidden recorder for push-to-talk. Lives only while needed; the background drives it. */
import { MicPermissionError, Recorder } from "@/utils/recorder";

const recorder = new Recorder();

browser.runtime.onMessage.addListener((m: { target?: string; type?: string }) => {
  if (m?.target !== "offscreen") return undefined;
  if (m.type === "rec:start") {
    return recorder
      .start()
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: err instanceof MicPermissionError ? "permission" : String(err) }));
  }
  if (m.type === "rec:stop") {
    return recorder.recording ? recorder.stop() : Promise.resolve({});
  }
  return undefined;
});
