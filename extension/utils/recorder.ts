/** Push-to-talk recording for the composer. Audio goes to the service for Whisper. */

export class MicPermissionError extends Error {}

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Side panels cannot show Chrome's prompt; requestMicAccess (micAccess.ts) gets access via the page.
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw new MicPermissionError();
      throw err;
    }
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
  }

  /** Stop and return the recording as base64 without the data: prefix. */
  async stop(): Promise<{ base64: string; mimeType: string }> {
    const rec = this.recorder;
    if (!rec) throw new Error("Not recording");
    const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    await stopped;
    const mimeType = rec.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    this.recorder = null;
    return { base64: dataUrl.split(",")[1] ?? "", mimeType: mimeType.split(";")[0] ?? "audio/webm" };
  }
}

