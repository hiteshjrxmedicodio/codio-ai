import { findChartIds, type ChartId } from "../chartIds";
import { loadChat, saveChat } from "../chatStore";
import type { CapturedBlock, ReportQA, ReportSummary, SavedDiagnosis, SavedReview } from "../types";
import { serviceSettings } from "./service";

export interface ReviewSave {
  /** The record this report already lives in; left out the first time, which makes a new one. */
  recordId?: string;
  title: string;
  /** Sent the first time only: the chart IDs are read from them. */
  blocks?: CapturedBlock[];
  /** The documentation check, once the provider has run it. */
  review?: SavedReview;
  icd?: { diagnoses: SavedDiagnosis[]; engineError?: string };
  summary?: ReportSummary;
  /** A question answered on the page since the last save. */
  addQa?: ReportQA[];
}

/**
 * Save what the companion did on a report into the extension's history, the same record the
 * side panel keeps for a summary: the ICD codes, the questions, and the documentation check with
 * its thumbs, under the chart's IDs. The provider never has to open the panel for any of it to be kept.
 */
export async function saveReview(input: ReviewSave): Promise<{ id: string; ids: ChartId[] } | { error: string }> {
  const settings = await serviceSettings();
  if (!settings?.agent) return { error: "Codio's service isn't reachable" };
  const limits = { maxChats: settings.agent.history_max_chats, keepDays: settings.agent.history_keep_days };
  const id = input.recordId ?? `s${Date.now()}`;
  const existing = input.recordId ? await loadChat(id) : null;
  const ids = existing?.ids?.length ? existing.ids : findChartIds(input.blocks ?? [], settings.agent.chart_id_labels ?? []);
  const summary = input.summary ?? existing?.summary;
  await saveChat(
    {
      id,
      title: summary?.report_type || existing?.title || input.title || "Coded report",
      updatedAt: Date.now(),
      items: [],
      history: [],
      ids,
      kind: existing?.kind,
      type: "summary",
      summary,
      qa: [...(existing?.qa ?? []), ...(input.addQa ?? [])],
      review: input.review ?? existing?.review,
      icd: input.icd ?? existing?.icd,
    },
    limits,
  );
  return { id, ids };
}
