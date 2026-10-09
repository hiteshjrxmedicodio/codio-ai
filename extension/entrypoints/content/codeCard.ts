/**
 * Highlight-to-code: the pill turns into a small card beside the highlighted words with the codes for
 * them (selection.ts asks the service; this shows the answer). When the highlight is not something
 * that can be coded, the card asks the provider to put a question about it by voice instead.
 */
import * as card from "./companionUi/cards";
import * as view from "./companionUi/view";

/** Where the last highlight sits, so its code card opens next to it. */
let anchor: DOMRect | undefined;

function open(html: string): void {
  view.openCard(html, "pointer", anchor);
}

export function showCodesLoading(at?: DOMRect): void {
  anchor = at;
  open(card.loadingCard("Codio AI", "Checking the highlighted text…"));
}

/** Shows the ICD-10-CM and CPT codes; false when the highlight has none, so the caller offers a question. */
export function showCodes(result: { kind: string; icd: card.Code[]; cpt: card.Code[] }): boolean {
  if (result.kind === "neither" || (!result.icd.length && !result.cpt.length)) return false;
  open(card.codesCard(result.kind, result.icd, result.cpt));
  return true;
}

export function showAskCard(text: string): void {
  open(card.askCard(text, /Mac/i.test(navigator.platform)));
}

export function showCodesError(): void {
  open(card.messageCard("Codio AI", "I couldn't code this right now."));
}
