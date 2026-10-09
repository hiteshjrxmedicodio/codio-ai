/**
 * A spoken question (push-to-talk), answered in place from the report once it has been read. Before
 * that, on a page that looks clinical, the question waits for the provider to allow the reading.
 */
import * as card from "./companionUi/cards";
import type { CardId } from "./companionUi/dock";
import { consent } from "./reportMemory";

export interface VoiceHost {
  report: () => { title: string; blocks: { heading: string; text: string }[] } | null;
  show: (html: string, where: CardId) => void;
  /** Keep the question until the report has been read. */
  hold: (question: string) => void;
  /** Keep the answer with the report's record, like a question asked in the panel. */
  persist: (qa: { q: string; a: string }[]) => void;
}

const send = <T>(message: Record<string, unknown>) => browser.runtime.sendMessage(message) as Promise<T>;

export async function answerByVoice(question: string, looksClinical: boolean, host: VoiceHost): Promise<void> {
  const report = host.report();
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
  const r = await send<{ answer?: string; error?: string }>({ type: "report:ask", title: report.title, report: text, question });
  host.show(card.answerCard(question, r.answer ?? "I couldn't answer that right now."), "answer");
  if (r.answer) host.persist([{ q: question, a: r.answer }]);
}
