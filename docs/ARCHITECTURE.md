# Architecture

## Two parts

The extension never holds an API key or calls a model. It reads the page, takes screenshots,
carries out browser actions and draws the chat. The service holds the prompts, both keys and
every model call. Keys and PHI stay out of the browser, prompts change without republishing
the extension, and the Codio engine can be plugged into the service later.

## Which model does what

The rule: **a bounded decision goes to the OpenAI Decisions API** (gpt-6-luna, input tokens
only at $0.10/1M, no output or thinking charges, several questions per request, ZDR and HIPAA
eligible). **Gemini is used only where text must be generated.** Every Decisions call falls back
to Gemini, or to simply running the step, so a Decisions outage never blocks the provider.

| Step | Question shape | Model | Fallback |
|---|---|---|---|
| Privacy gate: what kind of page is this | choice of 5 | Decisions | Gemini Flash-Lite, then closed |
| Pre-screen: is each finder worth running | 4 probabilities, one request | Decisions | run every finder |
| Criticality gate: is this finding worth showing | choice of 5 | Decisions | Gemini Flash |
| Which visible control to click | choice among the page's own controls | Decisions | agent clicks by position |
| Agent conversation and tool use | free text + function calls | Gemini 3.8 Flash | none |
| Finders: contradictions, ambiguity, gaps, slips | quoted findings | Gemini 3.8 Flash | none |
| Section mapping, screenshot transcription | text | Gemini 3.8 Flash | none |
| Fix guidance (after a thumbs up) | text | Gemini 3.8 Flash | none |
| Voice: speech to text | audio | OpenAI Whisper | none |
| Voice: tidy the transcript | text | Gemini Flash-Lite | raw transcript |

## The docked panel

Chrome's side panel cannot be sized by an extension, so Codio docks its own panel into the page.
The toolbar icon toggles it on the current tab (`entrypoints/background.ts`); the content script
(`entrypoints/content/dock.ts`) adds an iframe of `panel.html` on the right, never narrower than
25% of the window and up to 60%, with a drag handle whose width is remembered, and narrows the page
by the same width. The background remembers docked tabs for the session and re-docks after a
reload. The panel works on its own tab only (`utils/tab.ts` `ownTabId`): screenshots are cropped
to the page left of the panel, and model positions map onto that area.

## Reading a report in a background copy

With `report.background_tab` on, a yes to "May I read it?" does not scroll the provider's tab.
`utils/workTab.ts` opens the same address in a new inactive tab next to theirs (it shares the
browser's sign-in, so it shows the same chart), groups the two (into the provider's own tab group
if they have one, otherwise a new blue "Codio" group), waits for the copy to load and its text to
stop growing, scrolls and reads it there, then closes it and removes a group it made. The provider
keeps working meanwhile. A copy that does not load within `report.background_load_seconds`, or
reads short (lazy parts of a page can wait to be on screen), falls back to reading the provider's
tab, which they already agreed to. PDFs are fetched directly and reports drawn as images need the
visible tab (Chrome screenshots only that), so neither uses the copy.

A read belongs to the page it started on. Switching tabs mid-read leaves it running; the result
waits for that page, and a report approved meanwhile is read next. Tab switches are answered
after 120 ms (page loads still wait about a second for the page to settle) and the summary view
fades between pages and states instead of jumping.

## Chart sites and chart IDs

The provider can save a site (a whole origin, so every path and PDF on it, and blob: PDFs it makes)
as where they read charts (`utils/chartSites.ts`). On a saved site a closed gate is overridden: the
gate only names the kind of note. The first time a chart is recognised on an unsaved site, a banner
offers to save it once; the "Should I read it?" question also offers "Always on this site". Saved
sites are listed and removable in Settings.

Each conversation records the chart it was about: identifiers found next to the labels in
`agent.chart_id_labels` (masked values skipped; `utils/chartIds.ts`) and the note kind. Past chats
show them under the title.

## Permission before reading, and chart IDs

Summary-only mode never reads a report on its own. Reading scrolls the provider's screen, so when
the gate says a page is clinical the panel shows "A procedure note is open. May I read it?" and
nothing moves until the provider presses Read this report (`useReportSummary` phase
`permission`). The yes holds for that page for the session.

Chart IDs found on the page (`agent.chart_id_labels`) are saved with the current chat or summary
automatically, as soon as there is one to save them to (`utils/useChartIdOffer.ts`). The only
question is when something was already saved under that ID: the panel offers to open it, and Not
now saves the ID on the current one instead. Saved summaries live in the same store as chats
(`type: "summary"`), History lists the current mode's records, and its search box matches titles
and chart IDs.

## Dictation and fill mode

The mic button opens a choice (`components/MicMenu.tsx`): Speak a message (push-to-talk into the
message box) or Live transcribe a note. Live transcription (`utils/liveRecorder.ts`) records in
back-to-back pieces from one stream, each a complete audio file. A piece ends at the first pause
(350 ms of quiet) after `dictation.segment_seconds`, or at twice that with no pause, so no word is
cut in two; silent pieces are dropped before Whisper can invent words for them. Each piece goes
to `POST /v1/dictation/transcribe` in order, with the end of the text so far
(`dictation.context_chars`) as Whisper context, and the words appear in the panel as they come
back. On Done, `POST /v1/dictation/structure` runs P-DICT-REPORT over the whole transcript, which
files what was said under the configured `sections`, adding nothing. The panel shows the sections, editable, and arms fill mode in every
frame of the tab (`entrypoints/filler.content.ts`, all frames because EMR forms often sit in
frames). A small Codio tag then follows the cursor on the page. Clicking an empty text field
sends its label and nearby text to the panel, which asks `POST /v1/dictation/match`: a label that
names a section or one of its `dictation.field_aliases` matches directly, anything else goes to
D-PICK-SECTION, and a weak answer leaves the field alone. The text goes in as the browser's own
insert, so the page's frameworks see it and Cmd/Ctrl+Z undoes it. Fields with text, search boxes,
and non-text inputs are never filled; Esc stops fill mode.

An extension can draw only inside web pages, so the cursor tag exists on pages, not across the
desktop the way a native app can.

## Page lifecycle

```
tab changes ──► read page text (content script)
             └► privacy gate (Decisions; screenshot only when the page has no text)
                   ├─ not clinical ─► no chip; when the provider asks something, "Should I read it?"
                   │                  [Read this page] reopens the gate for that page only, [Not now] answers without it
                   └─ clinical ─► "I can see a visit note."
                                  └─ a note kind + auto-check on ─► documentation check ─► cards
```

Gate and check results are cached per page: address plus a fingerprint of the start of the
text (digits ignored, so timers do not make a new page), so single-page EMRs that swap notes
without changing the address still count as new.

Single-page EMRs draw the shell first and the note later, and the shell alone reads as not
clinical. Three things keep that first look from sticking: the content script
(`entrypoints/content/watch.ts`) signals the panel whenever the page's text changes by 200+
characters and then settles; a closed verdict is decided again once the page has grown by 300+
characters; and sending a message looks at the page again before asking permission. A failed
gate call is never cached. A note is auto-checked the first time it is seen as readable.

## Agent loop (one provider message)

```
observe (gate, page text, screenshot, latest check summary)
  └► POST /v1/agent/turn ──► Gemini with tools
        ├─ text only ─────────────────────────────► reply shown, done
        ├─ run_documentation_check (server tool) ─► runs here, loops
        └─ point / click_control / click / scroll / type_text / wait / look (browser tools)
              └► extension carries them out ─► observe again ─► POST /v1/agent/turn …
```

The service is stateless; the extension keeps the opaque Gemini history and sends it back.

**Past chats.** Each conversation (shown items + Gemini history, screenshots stripped) is saved in
`browser.storage.local` by `extension/utils/chatStore.ts` when a turn settles. The clock button
lists them; opening one restores both, so the conversation continues where it stopped against
whatever page is open now. They hold chart text, so they never leave the browser and expire:
`agent.history_max_chats` and `agent.history_keep_days` in `config.yaml`.
Older screenshots are dropped from the history (`agent.keep_screenshots`) to control cost.
`click_control` lists the visible controls, removes record-changing ones by label, and lets the
Decisions API pick, which is more accurate than pixel coordinates on dense EMR screens.

## Documentation check

```
sections ─► pre-screen (Decisions, 4 probabilities) ─► skip finders below skip_below
         ├► code screen K1–K6 (free, gated by config)
         └► remaining finders in parallel (Gemini)
               ─► quote check ─► merge ─► criticality gate per finding (Decisions)
               ─► rank coding > denial > interpretation ─► top 5 as cards
```

A thumbs up runs P-FIX for that card; a thumbs down is logged and the provider is never asked why.

## Privacy and safety

- The gate runs before anything from a page is used. The service enforces a closed gate again:
  it strips page text and screenshots from the agent's input whatever the extension sent.
- Read-only twice over: the agent prompt forbids record-changing controls, and the extension
  refuses to list or click any control whose label matches the blocked-controls pattern, which is fixed in `extension/utils/settings.ts` and not editable by the user.
- The service listens on 127.0.0.1 and accepts only the extension and localhost.
- `service/.env` and `service/data/` (feedback log, holds quotes) are git-ignored.

## Later

- Code-specificity finders, then code prediction through the Codio engine.
- `required_sections` comes from config today; replace with a platform lookup by specialty and report type.
- Per-provider suppression from thumbs-down patterns, after specialist review.
