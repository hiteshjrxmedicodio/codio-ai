# Prompt index

Every prompt follows `PROMPT_STANDARD.md` (enforced by `service/test/promptLint.test.ts`).
Gemini prompts are configured under `blocks` in `service/config/config.yaml`; Decisions API
question instructions under `decision_blocks`. Response schemas live next to the calling code.

## Gemini (text must be generated)

| Block | File | Only job | Code |
|---|---|---|---|
| P-AGENT | `agent/p_agent.txt` | Help the provider with the clinical work on screen by talking, pointing and read-only actions | `modules/agent/agent.ts` |
| P-CON | `cdi/p_con_contradictions.txt` | Find pairs of statements that cannot both be true | `modules/cdi/finders/contradictions.ts` |
| P-AMB | `cdi/p_amb_ambiguity.txt` | Find statements a careful reader could take two materially different ways | `modules/cdi/finders/ambiguity.ts` |
| P-INC | `cdi/p_inc_unaddressed.txt` | Find clinical threads started and not finished | `modules/cdi/finders/unaddressed.ts` |
| P-VAL | `cdi/p_val_validation.txt` | Find documented diagnoses the note's own evidence does not adequately show (clinical validation, from the Codio engine's P058) | `modules/cdi/finders/validation.ts` |
| P-FIX | `cdi/p_fix_guidance.txt` | Say where a problem is and what kind of change resolves it, compliantly | `modules/cdi/fix/fix.ts` |
| P-READ-SCREEN | `reading/p_read_screen.txt` | Transcribe visible note text exactly, under on-screen headings | `modules/reading/screenRead.ts` |
| P-SUMMARIZE | `report/p_summarize_report.txt` | List every field in a complete report and summarise what each says | `modules/report/summarize.ts` |
| P-CDI-NORMALIZE | `coding/p_cdi_normalize.txt` | Preprocessing: correct spelling, grammar, abbreviations and formats without changing meaning, returning every change and every unsettled item (from the Codio engine's p001_2 and P060). Owns all writing errors; the review never reports one | `modules/cdi/normalize/normalize.ts` |
| P-DX-EXTRACT | `coding/p_dx_extract.txt` | List each diagnosis the report documents, with the exact phrases | `modules/icd/extract.ts` |
| P-DX-PARAMS | `coding/p_dx_params.txt` | State the coding-relevant details documented for one diagnosis | `modules/icd/extract.ts` |
| P-ICD-CODE | `coding/p_icd_code.txt` | Assign ICD-10-CM codes the highlighted text supports | `modules/selection/codeSelection.ts` |
| P-CPT-CODE | `coding/p_cpt_code.txt` | Assign CPT codes the highlighted text supports | `modules/selection/codeSelection.ts` |
| P-PROC-EXTRACT | `coding/p_proc_extract.txt` | Decide completion status and list each procedure performed, paired with its parent | `modules/cpt/extract.ts` |
| P-READ-FILE | `reading/p_read_file.txt` | Transcribe an attached document's clinical text exactly, under its own headings | `modules/files/readFile.ts` |
| P-READ-MAP | `reading/p_read_section_map.txt` | Assign captured text to the configured standard sections | `modules/reading/sectionMap.ts` |
| P-VOICE-CLEAN | `voice/p_voice_clean.txt` | Turn a raw speech transcript into the message the provider meant | `modules/voice/voice.ts` |
| P-DICT-REPORT | `dictation/p_dictation_report.txt` | File a dictated note under the report sections it belongs to | `modules/dictation/dictation.ts` |

## Decisions API (bounded answers; Gemini fallback uses the same text)

| Block | File | Question | Code |
|---|---|---|---|
| P-PAGE-CHECK | `page/p_page_check.txt` | Choice: what kind of page is this (privacy gate) | `modules/page/pageCheck.ts` |
| P-GATE | `cdi/p_gate_criticality.txt` | Choice: is this finding critical, and why | `modules/cdi/gate/gate.ts` |
| D-SCREEN-CON / AMB / INC / VAL | `decisions/p_screen_*.txt` | Probability: is the matching finder worth running | `modules/cdi/prescreen/prescreen.ts` |
| P-CPT-SELECT | `coding/p_cpt_select.txt` | Choice per procedure: which retrieved CPT candidate matches it | `modules/cpt/select.ts` |
| D-SELECT-KIND | `decisions/p_select_kind.txt` | Choice: is highlighted text a diagnosis, a procedure, both or neither | `modules/selection/codeSelection.ts` |
| D-PICK-CONTROL | `decisions/p_pick_control.txt` | Choice: which visible control moves toward the goal | `modules/agent/pickControl.ts` |
| D-PICK-HISTORY | `decisions/p_pick_history.txt` | Choice: which history-form ICD-10-CM code names a historical diagnosis | `modules/icd/history.ts` |
| D-PICK-SECTION | `decisions/p_pick_section.txt` | Choice: which dictated section belongs in the clicked field | `modules/dictation/dictation.ts` |

## Inversion notes (author's working list, not in the prompts)

Failure classes each GUARDS section was written against, drawn from: copy-forward and template
text in most notes (JAMA, UCSF), speech-recognition errors around 7% with deletions, insertions,
prefixes and numbers most common (JAMA Network Open 2018), ACDIS/AHIMA compliant-query rules
(2022), browser-agent failure modes (layout shift, closing menus, inner scroll areas, modals,
login walls), and Decisions API guidance (refusals are not false; confidence needs thresholds).

| Block | Failure classes guarded |
|---|---|
| P-AGENT | reading a closed-gate page · record-changing controls · credentials · layout shift · closing menus · inner scroll · no-op loops · invented facts · leading the provider · payment pressure · overtrusting check results · long replies |
| P-PAGE-CHECK | public health content · clinical apps with no note · partial excerpts · interface text · patient mentioned without care documented |
| P-CON | stale copied text · default-normal templates · non-provider text against the provider · other-person statements · refinement read as conflict · uncertainty or synonyms read as conflict · silence read as conflict · units and timing · different structures vs coding-distinct sites · expected pre/post-procedure change · procedure title vs narrative · completion status · lost negation · misleading headings · capture cut-offs · accusatory wording |
| P-AMB | excluded or confirmed doubt · narrowed differentials · missing defining detail only when the note evidences it · unsettled abbreviations left by preprocessing · single-candidate references · current vs past · ranges crossing no boundary · old hedging · non-provider vagueness · inpatient uncertainty is usable · neutral tone |
| P-INC | own reference ranges · single isolated values · med lists as orders · orders and intentions read as documentation · legitimate deferral · missing cause or relationship only on the note's evidence · conditions only non-providers recorded · carried-forward problems with no management · distant links · setting depth · one gap one thread · capture cut-offs · terse but complete text |
| P-VAL | moving the criteria bar · non-provider evidence read as an evidence gap · treatment given vs ordered vs absent · single-value shortcuts · suspected or ruled-out read as present · demanding tests for clinically diagnosed conditions · one-sided evidence · vague missing element · implying the diagnosis is wrong |
| P-CDI-NORMALIZE | corrections from fluency or a single word · error-prone abbreviations · lost negation, uncertainty, timing or attribution · repairing suspected clinical errors · collapsing copied or template text · added diagnoses or detail · moving content between blocks |
| P-GATE | common read as harmless · untidy read as critical · facts outside the note · overstated descriptions · copy-forward, refinement and uncertainty artifacts · non-provider text against the provider · writing errors (preprocessing owns them) · validation gaps that are documentation, not diagnosis · blame |
| P-FIX | new clinical content · choices beyond the evidence · filler choices · one-sided evidence · payment pressure · preferred answers or confirm-this framing · accusatory procedure wording · inpatient uncertainty is an answer · teaching in the query · length |
| D-SCREEN-* | missing a real problem costs more than a wasted finder run, so lean high |
| D-PICK-CONTROL | terse or repeated labels · links out of the app · menus as the next step · weak matches |
| D-PICK-HISTORY | near-miss conditions in the same system · entries asserting an undocumented type · own-chapter old/sequela forms · none over a near miss |
| D-PICK-SECTION | abbreviated labels · partial or combined fields · non-clinical fields · weak matches |
| P-READ-SCREEN | interface chrome · altering small words and numbers · table pairs · column order · several notes · guessing blurred text |
| P-READ-MAP | vendor heading names · wrong template headings · several notes captured · addenda · text split across screens |
| P-VOICE-CLEAN | altering clinical terms or negations · adding content · spoken corrections · empty input · language |
| P-DICT-REPORT | misheard clinical words · negations, laterality, numbers · dictation commands · two-section statements · invented normal content · partial dictation |
