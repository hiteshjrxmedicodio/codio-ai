import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ReportSection } from "./api";
import { requestMicAccess } from "./micAccess";
import { LiveRecorder, type LivePiece } from "./liveRecorder";
import { MicPermissionError } from "./recorder";
import { activeTab, isOwnTab } from "./tab";

export type DictationPhase = "idle" | "recording" | "working" | "ready" | "error";

/** Tell every frame of this tab to start or stop fill mode. Frames loaded before install get the script first. */
async function toFrames(type: "fill:arm" | "fill:disarm"): Promise<void> {
  const tabId = (await activeTab()).id;
  if (tabId === undefined) return;
  try {
    await browser.tabs.sendMessage(tabId, { type });
  } catch {
    if (type === "fill:disarm") return;
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["/content-scripts/filler.js"] });
    await browser.tabs.sendMessage(tabId, { type });
  }
}

/**
 * Dictate a note, get it back as report sections, then fill fields on the page by clicking them.
 * The sections stay editable here; whatever they say when a field is clicked is what goes in.
 */
export function useDictation(segmentSeconds = 6) {
  const segmentMs = segmentSeconds * 1000;
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [filled, setFilled] = useState<string[]>([]);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef(new LiveRecorder());
  /** What has been heard so far, shown live while recording. */
  const [transcript, setTranscript] = useState("");
  const text = useRef("");
  /** Pieces are transcribed one after another so each gets the text before it as context. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const missed = useRef(0);
  /** Bumped on every start and discard, so pieces from an abandoned recording are dropped. */
  const session = useRef(0);
  const latest = useRef<ReportSection[]>([]);
  latest.current = sections;

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const arm = useCallback(async () => {
    await toFrames("fill:arm").catch(() => undefined);
    setFilling(true);
  }, []);

  const disarm = useCallback(async () => {
    await toFrames("fill:disarm").catch(() => undefined);
    setFilling(false);
  }, []);

  // The page asks which section belongs in the clicked field; only this tab's page is answered.
  useEffect(() => {
    const onMessage = (m: { type?: string; label?: string; nearby?: string; title?: string; section?: string }, sender: { tab?: { id?: number } }) => {
      if (m?.type === "fill:done") void isOwnTab(sender.tab?.id).then((own) => own && setFilled((f) => (f.includes(m.section ?? "") ? f : [...f, m.section ?? ""])));
      if (m?.type === "fill:stopped") void isOwnTab(sender.tab?.id).then((own) => own && setFilling(false));
      if (m?.type !== "fill:match") return undefined;
      return isOwnTab(sender.tab?.id).then(async (own) => {
        if (!own) return undefined;
        const usable = latest.current.filter((s) => s.text.trim());
        if (!usable.length) return null;
        const r = await api.matchField({ label: m.label ?? "", nearby: m.nearby ?? "", title: m.title ?? "", sections: usable.map((s) => s.name) });
        return usable.find((s) => s.name === r.section) ?? null;
      });
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  useEffect(() => () => void toFrames("fill:disarm").catch(() => undefined), []);

  /** Live transcription: pieces are written down in order while the provider keeps talking. */
  const start = useCallback(async () => {
    setError("");
    setTranscript("");
    text.current = "";
    queue.current = Promise.resolve();
    const mine = ++session.current;
    const onPiece = (p: LivePiece) => {
      if (!p.hadSound || mine !== session.current) return;
      queue.current = queue.current.then(async () => {
        if (mine !== session.current) return;
        try {
          const r = await api.transcribePiece(p.base64, p.mimeType, text.current);
          if (!r.text.trim() || mine !== session.current) return;
          text.current = [text.current, r.text.trim()].filter(Boolean).join(" ");
          setTranscript(text.current);
        } catch {
          missed.current += 1;
        }
      });
    };
    missed.current = 0;
    try {
      await recorder.current.start(segmentMs, onPiece);
    } catch (err) {
      if (!(err instanceof MicPermissionError) || (await requestMicAccess()) !== "granted") {
        setError("Codio needs the microphone to transcribe. Allow it in Settings, then try again.");
        setPhase("error");
        return;
      }
      await recorder.current.start(segmentMs, onPiece);
    }
    setSeconds(0);
    setPhase("recording");
  }, [segmentMs]);

  /** Finish: wait for the last pieces, then file the whole transcript under report sections. */
  const stop = useCallback(async () => {
    setPhase("working");
    try {
      await recorder.current.stop();
      await queue.current;
      if (!text.current.trim()) {
        setError("I couldn't hear anything. Try again closer to the microphone.");
        setPhase("error");
        return;
      }
      const r = await api.structureTranscript(text.current);
      if (!r.sections.length) {
        setError("I wrote down what you said, but nothing fitted a report section. Try again with section names.");
        setPhase("error");
        return;
      }
      setSections(r.sections);
      setFilled([]);
      setPhase("ready");
      await arm();
    } catch (err) {
      setError(`That dictation didn't go through. ${String(err instanceof Error ? err.message : err)}`);
      setPhase("error");
    }
  }, [arm]);

  const edit = useCallback((name: string, text: string) => {
    setSections((list) => list.map((s) => (s.name === name ? { ...s, text } : s)));
  }, []);

  const discard = useCallback(async () => {
    session.current += 1;
    if (recorder.current.recording) await recorder.current.stop().catch(() => undefined);
    text.current = "";
    setTranscript("");
    await disarm();
    setSections([]);
    setFilled([]);
    setError("");
    setPhase("idle");
  }, [disarm]);

  return { phase, seconds, transcript, sections, filled, filling, error, start, stop, edit, arm, disarm, discard };
}
