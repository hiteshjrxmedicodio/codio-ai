# CLAUDE.md — CDI Assist

Read `README.md`, `docs/ARCHITECTURE.md` and `docs/PROMPT_STANDARD.md` before changing anything.

## Hard rules

- **One prompt, one function.** Prompts are instructions only: no examples, no sample text, no
  lists of terms or cases. Follow the eight-section structure in `docs/PROMPT_STANDARD.md`.
  `pnpm test` runs the prompt lint; a failing prompt does not ship.
- **No code file over 400 lines.** Split by functionality into the existing folders.
  `service/test/fileSize.test.ts` enforces it.
- **Config is the single source of truth.** Models, thinking budgets, caps, switches, section
  names and record-check patterns live in `service/config/`. No constants in code.
- **Gemini thinking is always set per block.** Unset means adaptive thinking billed as output.
- **Response shape lives in the JSON schema in code**, never in the prompt text.
- **Navigation is read-only.** Never weaken the record-changing-control rule in the prompt or the
  blocked-controls check in `extension/entrypoints/content/actions.ts` and `controls.ts`.
  The one exception is dictation fill mode (`entrypoints/filler.content.ts`): it types a dictated
  section into an empty text field the provider clicked, and nothing else. It never overwrites a
  field, never presses a key or a button, and never saves or signs.
- **Chart text is PHI.** Service stays on localhost; never commit `service/.env`, `service/data/` or real charts.
- **Privacy gate before reading.** Nothing from a page reaches a model until the gate says clinical;
  `modules/agent/observation.ts` enforces a closed gate again on the service side. Never weaken either.
- **Patient identifiers never reach a model (HIPAA minimum necessary).** `core/privacy/redact.ts` scrubs every text
  part in `callBlock`, `callWithTools` and `decide`, and every summary and answer on the way out. Only age,
  sex/gender and insurance payer/plan are kept. Label lists live in `config.yaml` → `privacy`. Never add a model call
  that bypasses these three clients.
- **Bounded decisions go to the Decisions API** (`core/llm/openai.ts`), each with a fallback. Use Gemini
  only where text must be generated.

## Where things go

| Change | Place |
|---|---|
| New Gemini prompt | `service/prompts/<area>/p_<slug>.txt` + `blocks` entry in config.yaml + module under `service/src/modules/` + row in `docs/PROMPTS.md` + runner in `src/cli/blockRunners.ts` |
| New Decisions question | `service/prompts/decisions/p_<slug>.txt` + `decision_blocks` entry + caller using `decide()` with a fallback |
| New agent tool | `modules/agent/tools.ts` (client or server set) + executor in `extension/utils/agentLoop.ts` or `modules/agent/agent.ts` |
| New finder | Also register in `modules/cdi/finders/index.ts` and `pipeline.finders` |
| New record check | `service/config/screen_rules.yaml` + `modules/cdi/screen/` |
| New endpoint | the module's `*.routes.ts`, mounted in `src/app.ts` |
| Panel UI | `extension/components/`; page logic in `extension/utils/` |

Update `README.md`, `docs/ARCHITECTURE.md` or `docs/PROMPTS.md` in the same change when behaviour moves.
