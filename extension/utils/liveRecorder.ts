import { MicPermissionError } from "./recorder";

/** One finished piece of a live recording, ready for Whisper. */
export interface LivePiece {
  base64: string;
  mimeType: string;
  /** False when the piece was silence, which Whisper would otherwise fill with invented words. */
  hadSound: boolean;
}

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
/** Loudness (RMS, 0..1) below which the microphone counts as quiet. */
const SILENCE_RMS = 0.015;
/** A pause this long is where a piece may end, so no word is cut in two. */
const PAUSE_MS = 350;
/** With no pause at all, a piece still ends after this many times its target length. */
const MAX_FACTOR = 2;
const METER_MS = 50;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Records in back-to-back pieces from one microphone stream. Each piece is a complete audio file
 * (a fresh MediaRecorder), so it can be transcribed on its own while the provider keeps talking.
 * A piece ends at the first pause after its target length, never mid-word, or at twice the target
 * when the provider does not pause.
 */
export class LiveRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private meter: number | undefined;
  private pieceStart = 0;
  private quietMs = 0;
  private ctx: AudioContext | null = null;
  private peak = 0;
  private onPiece: (p: LivePiece) => void = () => undefined;
  private lastStop: Promise<void> = Promise.resolve();

  get recording(): boolean {
    return Boolean(this.stream);
  }

  async start(segmentMs: number, onPiece: (p: LivePiece) => void): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw new MicPermissionError();
      throw err;
    }
    this.onPiece = onPiece;
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    this.startPiece();
    this.meter = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
      this.peak = Math.max(this.peak, rms);
      this.quietMs = rms < SILENCE_RMS ? this.quietMs + METER_MS : 0;
      const age = Date.now() - this.pieceStart;
      if ((age >= segmentMs && this.quietMs >= PAUSE_MS) || age >= segmentMs * MAX_FACTOR) {
        this.endPiece();
        this.startPiece();
      }
    }, METER_MS);
  }

  private startPiece(): void {
    if (!this.stream) return;
    const rec = new MediaRecorder(this.stream, MIME ? { mimeType: MIME } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.lastStop = new Promise<void>((resolve) => {
      rec.onstop = async () => {
        const hadSound = this.peak >= SILENCE_RMS;
        this.peak = 0;
        const mimeType = (rec.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
        if (chunks.length) this.onPiece({ base64: await toBase64(new Blob(chunks, { type: mimeType })), mimeType, hadSound });
        resolve();
      };
    });
    rec.start();
    this.recorder = rec;
    this.pieceStart = Date.now();
  }

  private endPiece(): void {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  /** Stop and wait until the last piece has been handed over. */
  async stop(): Promise<void> {
    window.clearInterval(this.meter);
    this.endPiece();
    await this.lastStop;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
