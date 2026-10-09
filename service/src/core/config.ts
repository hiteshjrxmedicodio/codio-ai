import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

export const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const Thinking = z.union([z.enum(["minimal", "low", "medium", "high"]), z.number().int()]);
const Setting = z.enum(["operative", "enm", "inpatient", "unknown", "none"]);

const BlockConfig = z.object({
  prompt: z.string(),
  model: z.string(),
  thinking: Thinking,
  temperature: z.number(),
  max_output_tokens: z.number().int().positive(),
  enabled: z.boolean(),
});

const ConfigSchema = z.object({
  server: z.object({ host: z.string(), port: z.number().int(), json_limit: z.string() }),
  llm: z.object({ api_key_env: z.string(), timeout_ms: z.number().int(), parse_retries: z.number().int().min(0) }),
  openai: z.object({
    api_key_env: z.string(),
    base_url: z.string().url(),
    timeout_ms: z.number().int(),
    decisions_model: z.string(),
    transcribe_model: z.string(),
  }),
  blocks: z.record(z.string(), BlockConfig),
  decision_blocks: z.record(z.string(), z.object({ prompt: z.string() })),
  decisions: z.object({
    gate: z.object({
      provider: z.enum(["openai_decisions", "gemini"]),
      choices: z.array(z.object({ value: z.enum(["not_real", "not_critical", "coding", "denial", "interpretation"]), description: z.string() })).length(5),
    }),
    prescreen: z.object({
      enabled: z.boolean(),
      skip_below: z.number().min(0).max(1),
      finders: z.record(z.string(), z.string()),
    }),
    pick_control: z.object({
      enabled: z.boolean(),
      max_controls: z.number().int().positive(),
      min_confidence: z.number().min(0).max(1),
    }),
  }),
  page_check: z.object({
    provider: z.enum(["openai_decisions", "gemini"]),
    fallback: z.enum(["gemini", "none"]),
    max_chars: z.number().int().positive(),
    min_confidence: z.number().min(0).max(1),
    choices: z.array(z.object({ value: z.string(), setting: Setting, description: z.string() })).min(2),
  }),
  agent: z.object({
    max_steps: z.number().int().positive(),
    max_page_chars: z.number().int().positive(),
    dom_min_chars: z.number().int().nonnegative(),
    keep_screenshots: z.number().int().nonnegative(),
    max_history_turns: z.number().int().positive(),
    auto_check_on_new_note: z.boolean(),
    history_max_chats: z.number().int().positive(),
    history_keep_days: z.number().int().positive(),
    chart_id_labels: z.array(z.string().min(1)),
  }),
  pipeline: z.object({
    finders: z.array(z.string()).min(1),
    gate_concurrency: z.number().int().positive(),
    max_suggestions: z.number().int().positive(),
    shown_answers: z.array(z.enum(["coding", "denial", "interpretation"])).min(1),
    min_confidence: z.number().min(0).max(1),
  }),
  privacy: z.object({
    enabled: z.boolean(),
    placeholder: z.string().min(1),
    keep_labels: z.array(z.string()),
    identifier_labels: z.array(z.string()).min(1),
    name_titles: z.array(z.string()),
  }),
  selection: z.object({
    enabled: z.boolean(),
    min_chars: z.number().int().positive(),
    max_chars: z.number().int().positive(),
    context_chars: z.number().int().nonnegative(),
    min_confidence: z.number().min(0).max(1),
    max_codes: z.number().int().positive(),
    choices: z.array(z.object({ value: z.enum(["diagnosis", "procedure", "both", "neither"]), description: z.string() })).length(4),
  }),
  companion: z.object({
    enabled: z.boolean(),
    min_hits: z.number().int().positive(),
    clinical_hints: z.array(z.string()).min(1),
  }),
  icd_pipeline: z.object({
    provider: z.enum(["decisions", "jev"]),
    decisions_model: z.string(),
    jev_path: z.string(),
    python: z.string(),
    workers: z.number().int().positive(),
    retrieval_limit: z.number().int().positive(),
    gemini_fallback: z.boolean(),
    gemini_model: z.string(),
    timeout_ms: z.number().int().positive(),
    include_statuses: z.array(z.enum(["current", "historical", "uncertain", "ruled_out"])).min(1),
    history_candidates: z.number().int().positive(),
    param_concurrency: z.number().int().positive(),
  }),
  cpt_pipeline: z.object({
    select_provider: z.enum(["openai_decisions", "gemini"]),
    attempted_modifier: z.string(),
    gate_threshold: z.number().min(0).max(1),
    report_max_chars: z.number().int().positive(),
    rag: z.object({
      api_key_env: z.string(),
      control_url: z.string().url(),
      api_version: z.string(),
      index_name: z.string(),
      namespace: z.string(),
      embedding_model: z.string(),
      code_field: z.string(),
      descriptor_fields: z.array(z.string()).min(1),
      lowercase_query: z.boolean(),
      top_k: z.number().int().positive(),
      score_threshold: z.number().min(0).max(1),
      concurrency: z.number().int().positive(),
      timeout_ms: z.number().int().positive(),
      rerank: z.object({
        enabled: z.boolean(),
        dense_weight: z.number().min(0).max(1),
        retrieve_k: z.number().int().positive(),
        bm25_k1: z.number().positive(),
        bm25_b: z.number().min(0).max(1),
      }),
    }),
  }),
  features: z.object({ summary_only: z.boolean() }),
  report: z.object({
    max_scroll_steps: z.number().int().positive(),
    max_screens: z.number().int().positive(),
    max_chars: z.number().int().positive(),
    background_tab: z.boolean(),
    background_load_seconds: z.number().positive(),
  }),
  files: z.object({
    max_mb: z.number().positive(),
    max_files: z.number().int().positive(),
    text_types: z.array(z.string()).min(1),
    model_types: z.array(z.string()).min(1),
  }),
  voice: z.object({ max_audio_mb: z.number().positive(), rephrase: z.boolean() }),
  dictation: z.object({
    max_audio_mb: z.number().positive(),
    segment_seconds: z.number().positive(),
    context_chars: z.number().int().nonnegative(),
    min_confidence: z.number().min(0).max(1),
    whisper_prompt: z.string(),
    field_aliases: z.record(z.string(), z.array(z.string())),
  }),
  sections: z.array(z.object({ name: z.string(), description: z.string() })).min(1),
  required_sections: z.record(z.string(), z.array(z.string())),
});

const Pattern = z.union([z.string(), z.object({ pattern: z.string(), flags: z.string().optional(), label: z.string().optional() })]);
const Answer = z.enum(["coding", "denial", "interpretation", "not_critical"]);
const RuleBase = z.object({ id: z.string(), answer: Answer, title: z.string() });

const ScreenRulesSchema = z.object({
  placeholders: RuleBase.extend({ patterns: z.array(Pattern) }),
  do_not_use: RuleBase.extend({ patterns: z.array(Pattern) }),
  signature: RuleBase.extend({ present_patterns: z.array(z.string()).min(1) }),
  required_sections: RuleBase,
  duplicates: RuleBase.extend({ min_chars: z.number().int().positive() }),
  dates: RuleBase,
});

export type Config = z.infer<typeof ConfigSchema>;
export type BlockConfig = z.infer<typeof BlockConfig>;
export type ScreenRules = z.infer<typeof ScreenRulesSchema>;
export type ScreenPattern = z.infer<typeof Pattern>;

function load<T>(file: string, schema: z.ZodType<T>): T {
  const raw = parse(readFileSync(join(SERVICE_ROOT, "config", file), "utf8"));
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`config/${file} is invalid: ${result.error.message}`);
  return result.data;
}

function validate(config: Config): void {
  const names = new Set(config.sections.map((s) => s.name));
  if (!names.has("other")) throw new Error("config.sections must include an 'other' section");
  for (const [setting, list] of Object.entries(config.required_sections)) {
    for (const name of list) {
      if (!names.has(name)) throw new Error(`required_sections.${setting} names unknown section '${name}'`);
    }
  }
  for (const id of config.pipeline.finders) {
    if (!config.blocks[id]) throw new Error(`pipeline.finders names unknown block '${id}'`);
  }
  for (const [finder, question] of Object.entries(config.decisions.prescreen.finders)) {
    if (!config.blocks[finder]) throw new Error(`decisions.prescreen names unknown finder '${finder}'`);
    if (!config.decision_blocks[question]) throw new Error(`decisions.prescreen names unknown decision block '${question}'`);
  }
  if (!config.page_check.choices.some((c) => c.setting === "none")) {
    throw new Error("page_check.choices needs one choice with setting 'none' (the not-clinical answer)");
  }
}

let cached: { config: Config; rules: ScreenRules } | undefined;

function loadAll() {
  if (!cached) {
    const config = load("config.yaml", ConfigSchema);
    validate(config);
    cached = { config, rules: load("screen_rules.yaml", ScreenRulesSchema) };
  }
  return cached;
}

export function getConfig(): Config {
  return loadAll().config;
}

export function getScreenRules(): ScreenRules {
  return loadAll().rules;
}

/** Prompt file for a Gemini block or a Decisions API block. */
export function getPromptPath(id: string): string {
  const cfg = getConfig();
  const path = cfg.blocks[id]?.prompt ?? cfg.decision_blocks[id]?.prompt;
  if (!path) throw new Error(`No block '${id}' in config.yaml blocks or decision_blocks`);
  return path;
}

export function getBlockConfig(id: string): BlockConfig {
  const block = getConfig().blocks[id];
  if (!block) throw new Error(`No block '${id}' in config.yaml`);
  return block;
}
