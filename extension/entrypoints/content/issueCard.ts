/**
 * A documentation suggestion opened on the report: clicking its highlighted words turns the pill into a
 * card beside them with the problem and what to change. This keeps which suggestion that card shows, so
 * a fix landing or a vote can redraw it, and a click elsewhere (the companion's dismiss) closes it.
 */
import { suggestionRect } from "./annotate";
import * as card from "./companionUi/cards";
import * as view from "./companionUi/view";

export interface ReviewState {
  suggestions: card.Suggestion[];
  votes: Record<number, card.Vote>;
  fixes: Record<number, card.Fix>;
}

let pointed: number | null = null;

/** Open the card beside the suggestion's words. False when its words were not found on the page. */
export function openIssue(r: ReviewState, index: number): boolean {
  const s = r.suggestions[index];
  const at = suggestionRect(index);
  if (!s || !at) return false;
  pointed = index;
  view.openCard(card.issueCard(s, index, r.votes[index], r.fixes[index]), "pointer", at);
  return true;
}

/** Redraw the open card when it shows `index` (its fix landed, or its vote changed). */
export function refreshIssue(r: ReviewState, index: number): void {
  if (pointed === index && view.isCard()) openIssue(r, index);
}

export function closeIssue(): void {
  pointed = null;
}
