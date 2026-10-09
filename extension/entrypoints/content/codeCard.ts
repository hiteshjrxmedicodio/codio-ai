/**
 * Highlight-to-code: the pill turns into a small card beside the highlighted words with the codes for
 * them (selection.ts asks the service; this shows the answer). The card closes on its own when the
 * highlight is not something that can be coded, and the companion's own dismiss closes it otherwise.
 */
import * as card from "./companionUi/cards";
import * as view from "./companionUi/view";

const NOT_CODABLE_MS = 1800;

/** Where the last highlight sits, so its code card opens next to it. */
let anchor: DOMRect | undefined;
let closeTimer = 0;

function open(html: string): void {
  window.clearTimeout(closeTimer);
  view.openCard(html, "pointer", anchor);
}

export function showCodesLoading(at?: DOMRect): void {
  anchor = at;
  open(card.loadingCard("Codio AI", "Checking the highlighted text…"));
}

export function showCodes(result: { kind: string; icd: card.Code[]; cpt: card.Code[] }): void {
  if (result.kind === "neither" || (!result.icd.length && !result.cpt.length)) {
    open(card.messageCard("Codio AI", "This isn't a diagnosis or procedure I can code."));
    closeTimer = window.setTimeout(() => view.closeCard(), NOT_CODABLE_MS);
    return;
  }
  open(card.codesCard(result.kind, result.icd, result.cpt));
}

export function showCodesError(): void {
  open(card.messageCard("Codio AI", "I couldn't code this right now."));
}
