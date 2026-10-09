import { getConfig } from "../../../core/config";
import { redactBlocks } from "../../../core/privacy/redact";
import { withoutHistory } from "../../../core/sections";
import { mapLimit } from "../../../core/limit";
import type { AnalyzeResult, BlockError, CareSetting, Finding, Section, Suggestion, Usage } from "../../../core/types";
import { FINDERS } from "../finders";
import { runGate } from "../gate/gate";
import { prescreenFinders } from "../prescreen/prescreen";
import { runCodeScreen } from "../screen/codeScreen";
import { preprocessSections, restoreQuotes } from "./preprocess";
import { checkQuotes } from "./quoteCheck";
import { mergeDuplicates, rankAndCap } from "./rank";

/**
 * Step 0: preprocessing corrects spelling, grammar and abbreviations; the finders read the corrected
 * note, and their quotes are put back into the page's wording afterwards.
 * Step 1: Decisions API pre-screen decides which finders are worth running.
 * Step 2: code screen + finder prompts in parallel.
 * Step 3: quote check, merge, then one gate call per finding in parallel.
 * Step 4: rank and cap. A failing block is reported in `errors`; it never sinks the run.
 */
export async function analyzeNote(raw: Section[], setting: CareSetting): Promise<AnalyzeResult> {
  // Privacy: identifiers are removed before any check reads the note.
  // History sections (past medical, surgical, family, social history) are not this encounter: not reviewed.
  const sections = withoutHistory(redactBlocks(raw.map((s) => ({ heading: s.name, name: s.name, text: s.text }))).map(({ name, text }) => ({ name, text })));
  const started = Date.now();
  const cfg = getConfig().pipeline;
  const usage: Usage[] = [];
  const errors: BlockError[] = [];

  const ruleSuggestions = runCodeScreen(sections, setting);
  const pre = await preprocessSections(sections);
  if (pre.usage) usage.push(pre.usage);
  if (pre.error) errors.push({ block: "P-CDI-NORMALIZE", message: `${pre.error} (the review read the note as written)` });
  const prescreen = await prescreenFinders(cfg.finders, pre.sections, setting);

  const finderRuns = await Promise.all(
    prescreen.run.map(async (id) => {
      const finder = FINDERS[id];
      if (!finder) {
        errors.push({ block: id, message: "No finder registered for this block id" });
        return [];
      }
      try {
        const { findings, usage: u } = await finder(pre.sections, setting);
        usage.push(u);
        return findings;
      } catch (err) {
        errors.push({ block: id, message: String(err) });
        return [];
      }
    }),
  );

  // Quotes must match the page as written, so highlights land; one only the corrected note holds is still kept.
  const restored = restoreQuotes(finderRuns.flat(), sections, pre.changes);
  const onPage = checkQuotes(restored, sections);
  const corrected = checkQuotes(onPage.dropped.map((d) => d.finding), pre.sections);
  const kept = [...onPage.kept, ...corrected.kept];
  const dropped = corrected.dropped;
  const merged = mergeDuplicates(kept);

  const gated = await mapLimit(merged, cfg.gate_concurrency, async (finding: Finding): Promise<Suggestion | null> => {
    try {
      const { gate, usage: u } = await runGate(finding, sections, setting);
      if (u) usage.push(u);
      return { ...finding, gate };
    } catch (err) {
      errors.push({ block: "P-GATE", message: `${finding.id}: ${String(err)}` });
      return null;
    }
  });

  const all = [...ruleSuggestions, ...gated.filter((g): g is Suggestion => g !== null)];
  const { shown, hidden } = rankAndCap(all, {
    shownAnswers: cfg.shown_answers,
    maxSuggestions: cfg.max_suggestions,
    minConfidence: cfg.min_confidence,
  });

  return { suggestions: shown, hidden, dropped, usage, errors, prescreen, ms: Date.now() - started };
}
