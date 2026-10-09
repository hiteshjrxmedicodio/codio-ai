import { getConfig, getScreenRules } from "../../../core/config";
import type { CareSetting, GateResult, Section, Suggestion } from "../../../core/types";
import { findingId } from "../note";
import { compile, findDates, matches, normalise } from "./patterns";

type Rule = { id: string; answer: GateResult["answer"]; title: string };

function suggestion(rule: Rule, quotes: Suggestion["quotes"], detail: Record<string, unknown>): Suggestion {
  return {
    id: findingId(),
    block: rule.id,
    kind: "record",
    title: rule.title,
    quotes,
    detail,
    confidence: 1,
    gate: { answer: rule.answer, reason: "Deterministic record check; answer set in screen_rules.yaml", confidence: 1, source: "rule" },
  };
}

function patternChecks(sections: Section[], rule: Rule & { patterns: Parameters<typeof compile>[0][] }): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of rule.patterns.map(compile)) {
    for (const s of sections) {
      for (const text of matches(s.text, p)) out.push(suggestion(rule, [{ section: s.name, text }], { matched: p.label }));
    }
  }
  return out;
}

function signatureCheck(sections: Section[], setting: CareSetting): Suggestion[] {
  const rule = getScreenRules().signature;
  const required = getConfig().required_sections[setting] ?? [];
  if (!required.length) return [];
  const all = sections.map((s) => s.text).join("\n").toLowerCase();
  const present = rule.present_patterns.some((p) => all.includes(p.toLowerCase()));
  return present ? [] : [suggestion(rule, [], { setting })];
}

function requiredSectionCheck(sections: Section[], setting: CareSetting): Suggestion[] {
  const rule = getScreenRules().required_sections;
  const filled = new Set(sections.filter((s) => s.text.trim()).map((s) => s.name));
  const missing = (getConfig().required_sections[setting] ?? []).filter((name) => !filled.has(name));
  if (!missing.length) return [];
  // One card for all of them: several near-identical cards would crowd out real findings.
  const names = missing.map((n) => n.replace(/_/g, " ")).join(", ");
  return [suggestion({ ...rule, title: `${rule.title}: ${names}` }, [], { sections: missing, setting })];
}

function duplicateCheck(sections: Section[]): Suggestion[] {
  const rule = getScreenRules().duplicates;
  const seen = new Map<string, { section: string; text: string }>();
  const out: Suggestion[] = [];
  for (const s of sections) {
    for (const para of s.text.split(/\n\s*\n/)) {
      if (para.trim().length < rule.min_chars) continue;
      const key = normalise(para);
      const first = seen.get(key);
      if (first) out.push(suggestion(rule, [first, { section: s.name, text: para.trim() }], {}));
      else seen.set(key, { section: s.name, text: para.trim() });
    }
  }
  return out;
}

function futureDateCheck(sections: Section[], now: Date): Suggestion[] {
  const rule = getScreenRules().dates;
  const out: Suggestion[] = [];
  for (const s of sections) {
    for (const d of findDates(s.text)) {
      if (d.date.getTime() > now.getTime()) out.push(suggestion(rule, [{ section: s.name, text: d.raw }], { date: d.date.toISOString().slice(0, 10) }));
    }
  }
  return out;
}

/** K1–K6. Free, synchronous, and already gated: each rule carries its answer in config. */
export function runCodeScreen(sections: Section[], setting: CareSetting, now = new Date()): Suggestion[] {
  const rules = getScreenRules();
  return [
    ...patternChecks(sections, rules.placeholders),
    ...patternChecks(sections, rules.do_not_use),
    ...signatureCheck(sections, setting),
    ...requiredSectionCheck(sections, setting),
    ...duplicateCheck(sections),
    ...futureDateCheck(sections, now),
  ];
}
