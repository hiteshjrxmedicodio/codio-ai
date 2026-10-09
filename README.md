# Codio AI

Codio AI is a browser extension for providers, built by Medicodio. Open a chart in any EMR, scribe
tool or PDF and Codio reads it with you. It flags documentation problems that affect coding, risk a
denial, or change how a diagnosis, procedure or result is understood. It summarises the report field
by field and predicts ICD-10-CM and CPT codes for highlighted text. It also answers questions about
the report, typed or spoken. A small "Codio AI" companion follows the cursor and turns into cards over
the report. On a page that is not a medical chart, Codio says so and reads nothing.

Two parts live in this repo:

- `extension/`: the WXT (Manifest V3) Chrome extension, with the side panel, on-page companion and PDF viewer.
- `service/`: the local Node/Express service, which calls Gemini, the OpenAI Decisions API and Whisper.

Patient identifiers are removed before any text reaches a model. Age, sex or gender, and the insurance
payer are the only demographics Codio keeps (see "Patient privacy" below).

## Branches

- `main` holds stable, released code. Nothing is pushed to it directly.
- `dev` is where work lands. Push to `dev`, then open a pull request from `dev` into `main` when it is ready.

```bash
git checkout dev
git pull
# ...make changes...
git push origin dev
gh pr create --base main --head dev --title "Release: <summary>"
```

## Setup

```bash
pnpm install
cp service/.env.example service/.env   # add GEMINI_API_KEY and OPENAI_API_KEY
pnpm dev:service                        # start the local service
pnpm build:ext                          # then load extension/dist in chrome://extensions
```

The ICD pipeline also needs a local copy of the ICD engine data. Point `icd_pipeline.jev_path` in
`service/config/config.yaml` at it.

## Details

**Status (2026-10-09):** built, typechecks, 105 unit tests pass. Live-verified against real
APIs: privacy gate (Decisions API), CDI pipeline with Decisions pre-screen and gate, one agent
turn with a server tool, Whisper + rephrase, control picking. Not yet exercised inside a real
EMR; that testing happens in the Medicodio application.

**Current mode: summary only (2026-10-09).** `features.summary_only: true` in
`service/config/config.yaml` pauses chat, the automatic documentation check and navigation.
When a report opens (and the privacy gate agrees it is clinical), the panel reads the **whole**
report, not just the screen, and lists every field with a short summary and its key details:

- **PDF tab or PDF embedded in the page:** the PDF file is fetched and every page is read (`P-READ-FILE`).
- **Web page:** the content script scrolls the page and every large inner scroll area to its true end
  (position stops moving and content stops growing, so lazy-loaded parts load), reads all text, then
  scrolls back.
- **Report drawn as images:** screenshots screen by screen until the page stops moving (`P-READ-SCREEN`).

Then `POST /v1/report/summarize` runs `P-SUMMARIZE`. Set `summary_only: false` to bring the full
chat agent back.

**Patient privacy.** Patient identifiers (name, date of birth, MRN, address, phone, email, SSN, member and
policy numbers, relatives and contacts) are removed before any text reaches Gemini or the Decisions API, and
again from every summary and answer. Only **age, gender and insurance payer/plan** are kept. Redaction is
deterministic code (`service/src/core/privacy/redact.ts`, configured under `privacy` in `config.yaml`), backed
by the reading and summary prompts. Limitation: a PDF or screenshot is an image, so Gemini sees it before any
text exists to redact; the prompts tell it not to transcribe identifiers and the output is scrubbed, but the
image itself still reaches Google. A BAA with Google and OpenAI is required before real patient data is used.

**Companion cursor and highlight-to-code.** While the Codio side panel is open, a small Codio tag follows the
pointer on the page (it hands over to dictation's fill tag during fill mode). Highlighting text asks the
Decisions API whether it is a diagnosis, a procedure, both or neither (`D-SELECT-KIND`); codable text gets
ICD-10-CM (`P-ICD-CODE`) and/or CPT (`P-CPT-CODE`) predictions from Gemini, shown in a card beside the
selection with a copy button per code (`POST /v1/select/code`, configured under `selection`). Format-invalid
codes are dropped. A single model call for now; the full engine can replace it later.

**Push-to-talk.** With the panel open, hold **⌘ Command + ⌥ Option** (Ctrl+Alt on Windows) on the page and speak; the
companion cursor turns into a pulsing mic ("Listening…"), then "Thinking…" on release. Recording happens in the side
panel (which owns the microphone permission), Whisper transcribes it, and the text is asked in the panel as if typed:
answered from the open report in summary mode, or sent to the chat otherwise. Any other key during the hold cancels.

**Codio AI companion (primary interface, no panel needed).** One element on every page that follows the
pointer and changes shape in place: highlight text → code card (code and name only, placed beside the
highlight and kept on screen); a page that looks like a report (local heading count, nothing sent) →
permission card ("Code this report?") → on yes, the whole report is read and the ICD pipeline runs on it (no
summary): the ICD-10 card in the top-right stack lists each extracted diagnosis phrase with its code beside it,
and each phrase is highlighted and numbered on the report. Clicking a phrase, in the card or on the chart
(the highlighted words or their marker, `annotate.ts`), opens that diagnosis: its code, the documented
parameters, and the **prediction trail** the engine took (index lookup, chapter → category → code with
confidence, the linked Excludes/see-also categories it also checked as one line, the candidates it compared,
its pick and the check against the chart; built in `service/bridge/jev_bridge.py` `trail()`). **Check
documentation** in that card runs the CDI check into the Review card, each suggestion with thumbs up (logged
to `/v1/feedback`, then "what to change" from `/v1/cdi/fix`) and thumbs down (logged, dropped from the note).
The chart shows one set of highlights at a time, the set of the card in use. Card stack
(`companionUi/dock.ts`): ICD-10, Review, CPT, Final codes, answers; every header always visible, one card open
at a time with a capped height, the pill keeps following the pointer and only hides over the stack; CPT and
final cards are filled by the `companion:prediction` message. Everything the companion does is saved where
the panel saves (`utils/bg/reviewStore.ts` → History record under the chart's IDs: ICD codes, the check and
its thumbs, voice questions), so the panel only needs opening for more; opened on a coded page it shows those
codes and that review instead of reading the report again. After a refresh, a report already approved this
session is read again and, if its words are unchanged, the last codes come straight back from the session
cache (`utils/bg/reportCache.ts`); a changed report is coded again. Hold ⌘⌥ → listening mic, answered in place.
Click elsewhere returns it to the pill and clears the highlight. Code: `extension/entrypoints/content/
companion.ts` (controller), `companionUi/` (view, styles, cards), `annotate.ts`, `permission.ts`,
`selection.ts`, `pushToTalk.ts`; recording via `entrypoints/offscreen/`. The side panel remains for chat.

**ICD pipeline.** On a report the provider allowed, it runs automatically: diagnosis extraction (`P-DX-EXTRACT`, each
diagnosis with the exact phrases that state it, highlighted and numbered on the report) → coding parameters per
diagnosis (`P-DX-PARAMS`: documented details and the ones missing) → ICD-10-CM code per diagnosis from the ICD
engine in `~/Desktop/jev_icd_engine` (CMS index search, tree walk, Excludes/see links, verification, Gemini fallback)
through `service/bridge/jev_bridge.py` (`POST /v1/icd/predict`, configured under `icd_pipeline`). The engine's
pick-one questions are answered by the **OpenAI Decisions API** (`bridge/decisions_adapter.py`, provider
`decisions`, the default) or by Jev (provider `jev`, needs `TYPESAFE_API_KEY`). The engine folder is never edited.
Everything sent is redacted first. History, ruled-out and uncertain diagnoses are listed but not coded. Each result carries
`trail` (the engine's path, grouped for display) so the companion can show how the code was reached.

## How it works, in one paragraph

Every time the tab changes, the extension reads the page text and asks the **privacy gate**
(OpenAI Decisions API) what kind of page it is. Not clinical → the panel says *"This page
isn't a medical chart, so I won't read its data."* and nothing from the page reaches any
model. Clinical → the note is read, checked automatically when it is a note, and every chat
message goes to the **agent** (Gemini) with a screenshot and the page text. The agent replies,
or calls browser tools (point, click a control, scroll, type into search) that the extension
carries out before showing it the new screen.

## What the doctor sees

A docked panel (at least 25% of the window, drag its edge to widen, the width is remembered) styled like Claude in Chrome or ChatGPT's browser panel: a slim top bar (new chat, past chats,
settings), the conversation (your messages in a soft bubble, replies as plain text), one folded
"Took N steps" line for whatever the assistant did on the page, suggestion cards with a
thumbs up (shows what to change) and thumbs down, and one rounded input box with a mic, a send
arrow and, only while it can read the page, a chip saying what it is reading ("Reading: Visit note"). On a page that is not a chart, a question asks "Should I read it?" before anything is read. Settings hold only provider choices: auto-check on open, microphone set-up, a privacy note, version and status. The service address is fixed at build time (`WXT_SERVICE_URL`) and the blocked-controls pattern is fixed in code.
An empty chat offers three starters. Light and dark follow the browser.

**Attachments.** The **+** in the input box (or drag-and-drop, or paste an image) attaches chart
reports: PDFs, scans or photos, and text files, up to 5 files of 15 MB each. Each file is read by
the service as soon as it is added (`POST /v1/files/read`: text decoded directly; PDFs and images
transcribed by Gemini with `P-READ-FILE`, then mapped to sections). Attached documents stay part
of the conversation, the agent sees them on every turn, and *check this note* can run on an
attachment. Attachments count as clinical because the provider chose to share them; the page gate
still governs the tab.

**Dictate a note.** The mic offers Speak a message or Live transcribe a note. Live transcription
shows the words as the provider speaks, then files the note under report
sections (pre-op diagnosis, findings, plan and so on, from what was said only) and turns on fill
mode: a small Codio tag follows the cursor on the page, and clicking an empty field types in the
section that belongs there. Edit the sections in the panel first if needed; Cmd/Ctrl+Z undoes a
fill, Esc stops fill mode, and nothing is ever saved or signed for you.

## Layout

```
cdi-assist/
├── service/                 Node + Express + TypeScript. Holds prompts, keys and every model call.
│   ├── .env                 GEMINI_API_KEY, OPENAI_API_KEY (git-ignored)
│   ├── config/              config.yaml (models, budgets, switches) · screen_rules.yaml (record checks)
│   ├── prompts/             one .txt per prompt, one function each (docs/PROMPT_STANDARD.md)
│   │   ├── agent/ page/ voice/ reading/      Gemini prompts
│   │   ├── cdi/                              finders, gate, fix
│   │   └── decisions/                        Decisions API question instructions
│   ├── src/
│   │   ├── core/            config, prompts, types, HTTP helpers, llm/ (gemini, geminiChat, openai)
│   │   ├── modules/agent/   agent turn, tools, observation + privacy, control picking
│   │   ├── modules/page/    privacy gate
│   │   ├── modules/cdi/     prescreen/ · finders/ · gate/ · fix/ · screen/ · pipeline/
│   │   ├── modules/reading/ screenshot transcription, section mapping
│   │   ├── modules/voice/   Whisper + rephrase
│   │   ├── modules/feedback/
│   │   └── cli/             run one block on a note exported from your application
│   └── test/
├── extension/               WXT + React 19 + Tailwind 4 (Chrome MV3, panel docked into the page)
│   ├── entrypoints/         background · content/ (DOM reader, actions, controls, pointer, dock, watch) · panel/ · mic/
│   ├── components/          TopBar · HistoryPanel · ChatView · EmptyState · StepGroup · MessageItem · Composer · SuggestionCard · SettingsPanel · icons
│   └── utils/               useChat · chatStore · agentLoop · observe · recorder · api · tab · settings · types
└── docs/                    ARCHITECTURE.md · PROMPT_STANDARD.md · PROMPTS.md
```

## Run it

```bash
pnpm install
pnpm dev:service          # http://127.0.0.1:8787 (keys are already in service/.env)
pnpm build:ext            # then load extension/dist/chrome-mv3 as an unpacked extension
```

Click the toolbar icon to open the panel, open a chart in the Medicodio application, and chat.
The first time you press the microphone, a tab opens to grant microphone access once.

## Debug one prompt

```bash
cd service
pnpm block P-CON --chart note.txt --setting enm      # note.txt: a note exported from your application
pnpm block P-AGENT --chart note.txt --message "What's unclear in the assessment?"
pnpm test && pnpm typecheck
```

## Rules this project keeps

- One prompt, one function, instructions only: no examples, no lists. Enforced by `test/promptLint.test.ts`.
- No code file over 400 lines. Enforced by `test/fileSize.test.ts`.
- Every model, budget, threshold and switch lives in `service/config/`.
- Bounded decisions go to the Decisions API; Gemini only where text must be generated.
- Privacy gate before reading; a closed gate is enforced in the service as well as the extension.
- Read-only: record-changing controls are never offered, never clicked.
