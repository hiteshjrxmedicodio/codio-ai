/**
 * A spoken question (push-to-talk), answered in place from the report once it has been read. Before
 * that, on a page that looks clinical, the question waits for the provider to allow the reading.
 * A question about a highlight (one with nothing to code) carries the highlighted words, and is
 * answered from them and their surrounding text when the report has not been read.
 */
import * as card from "./companionUi/cards";
import type { CardId } from "./companionUi/dock";
import { consent } from "./reportMemory";
import type { Highlight } from "./selection";

export interface VoiceHost {
  report: () => { title: string; blocks: { heading: string; text: string }[] } | null;
  show: (html: string, where: CardId) => void;
  /** Keep the question until the report has been read. */
  hold: (question: string) => void;
  /** Keep the answer with the report's record, like a question asked in the panel. */
  persist: (qa: { q: string; a: string }[]) => void;
}

const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;

const aboutHighlight = (question: string, about: Highlight) => `${question}\n\nThe question is about this highlighted text: ${about.text}`;

export async function answerByVoice(question: string, looksClinical: boolean, host: VoiceHost, about?: Highlight | null): Promise<void> {
  const report = host.report();
  if (!report && about) {
    // Only the words already sent for coding: no report is read, so nothing new needs permission.
    host.show(card.loadingCard("Your question", "Looking at the highlighted text…"), "answer");
    const text = `--- Highlighted text\n${about.text}${about.context ? `\n\n--- Surrounding text\n${about.context}` : ""}`;
    const r = await send<{ answer?: string }>({ type: "report:ask", title: document.title, report: text, question: aboutHighlight(question, about) });
    host.show(card.answerCard(question, r.answer ?? "I couldn't answer that right now."), "answer");
    return;
  }
  if (!report) {
    if (looksClinical && consent() !== "declined") {
      host.hold(question);
      host.show(card.permissionCard(), "icd");
    } else {
      host.show(card.answerCard(question, "Open a medical report and let me read it first."), "answer");
    }
    return;
  }
  host.show(card.loadingCard("Your question", "Looking in the report…"), "answer");
  const text = report.blocks.map((b) => (b.heading ? `--- ${b.heading}\n${b.text}` : b.text)).join("\n\n");
  const r = await send<{ answer?: string; error?: string }>({ type: "report:ask", title: report.title, report: text, question: about ? aboutHighlight(question, about) : question });
  host.show(card.answerCard(question, r.answer ?? "I couldn't answer that right now."), "answer");
  if (r.answer) host.persist([{ q: question, a: r.answer }]);
}
