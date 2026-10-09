import { getConfig } from "../../../core/config";
import { redactBlocks } from "../../../core/privacy/redact";
import { mapLimit } from "../../../core/limit";
import type { AnalyzeResult, BlockError, CareSetting, Finding, Section, Suggestion, Usage } from "../../../core/types";
import { FINDERS } from "../finders";
import { runGate } from "../gate/gate";
import { prescreenFinders } from "../prescreen/prescreen";
import { runCodeScreen } from "../screen/codeScreen";
import { checkQuotes } from "./quoteCheck";
import { mergeDuplicates, rankAndCap } from "./rank";

/**
 * Step 1: Decisions API pre-screen decides which finders are worth running.
 * Step 2: code screen + finder prompts in parallel.
 * Step 3: quote check, merge, then one gate call per finding in parallel.
 * Step 4: rank and cap. A failing block is reported in `errors`; it never sinks the run.
 */
export async function analyzeNote(raw: Section[], setting: CareSetting): Promise<AnalyzeResult> {
  // Privacy: identifiers are removed before any check reads the note.
  const sections = redactBlocks(raw.map((s) => ({ heading: s.name, name: s.name, text: s.text }))).map(({ name, text }) => ({ name, text }));
  const started = Date.now();
  const cfg = getConfig().pipeline;
  const usage: Usage[] = [];
  const errors: BlockError[] = [];

  const ruleSuggestions = runCodeScreen(sections, setting);
  const prescreen = await prescreenFinders(cfg.finders, sections, setting);

  const finderRuns = await Promise.all(
    prescreen.run.map(async (id) => {
      const finder = FINDERS[id];
      if (!finder) {
        errors.push({ block: id, message: "No finder registered for this block id" });
        return [];
      }
      try {
        const { findings, usage: u } = await finder(sections, setting);
        usage.push(u);
        return findings;
      } catch (err) {
        errors.push({ block: id, message: String(err) });
        return [];
      }
    }),
  );

  const { kept, dropped } = checkQuotes(finderRuns.flat(), sections);
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
