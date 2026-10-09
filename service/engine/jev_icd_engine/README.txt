JEV ICD ROUTING ENGINE - GASTROENTEROLOGY TEST PACKAGE
=======================================================

CONTAINS PATIENT DATA (PHI). The chart text in inputs/gastro/ comes from production.
Keep this package on approved machines only. Do not email it, upload it or commit it to git.


WHAT THIS IS
------------
An ICD-10-CM coder built on Jev (TypeSafe System One). For each diagnosis phrase it asks Jev a
few pick-one questions and walks the official CMS tree:

  1. System    - which body system or kind of entry (21 CMS chapters + "general symptoms").
  2. Category  - one question over every category of that chapter plus every symptom category.
                 Each option shows the category name, its CMS inclusion terms, and every entry
                 inside it with that entry's inclusion terms.
  3. Entry     - the code inside the chosen category (one or more questions, depending on depth).
  4. Candidates- the entry plus codes linked to it in a DIFFERENT chapter, from:
                   - CMS Excludes1 / Excludes2 notes        inputs/excludes_links.json
                   - CMS alphabetic index see / see-also     inputs/see_links.json
                   - custom links (this client's practice)   inputs/custom_links.json
                 Links to the same chapter are never offered; the category step decides those.
  5. Decision  - one question: which candidate describes the documented condition.

If Jev answers "cannot decide" before an entry is reached, the diagnosis has no code and is meant
to go to the Gemini route. Those are reported separately and left out of the accuracy figure.


REQUIREMENTS
------------
- Python 3.9 or newer. The engine uses only the standard library.
- openpyxl, only for the Excel export:   pip install openpyxl
- A Jev API key from TypeSafe. Never write it into a file. Set it in the shell:
      export TYPESAFE_API_KEY=your_key_here


FOLDER LAYOUT
-------------
run_icd_direct_walk.py   the engine (entry point)
run_icd_system_walk.py   system question, link lookup, decision question (used by the engine)
run_icd_walk.py          shared question building and the Jev API call
icd_tree.py              loads the CMS tabular
index_route.py           loads the CMS alphabetic index (from the cached tree)
score_category.py        scores a run
export_run_excel.py      writes a run to Excel, one row per diagnosis

inputs/icd_tabular_2026.json       CMS ICD-10-CM FY2026 tabular, parsed
inputs/icd_index_2026.json         CMS FY2026 alphabetic index, flattened
inputs/icd_index_tree.json         CMS FY2026 alphabetic index, as a tree
inputs/excludes_links.json         code-to-code links from Excludes1 / Excludes2 notes
inputs/see_links.json              code-to-code links from index see / see-also references
inputs/custom_links.json           26 cross-chapter custom links, {entry code: [category]}
inputs/extraction_errors.json      diagnoses excluded from scoring because extraction sent the wrong site

inputs/gastro/gastro_all_units.json   ALL 1,500 gastro charts, 7,766 diagnoses, ready to run
inputs/gastro/gastro_cases.xlsx       the same 1,500 charts as a workbook (chart metadata + text by section)
inputs/gastro/gastro100c_units.json   the 100 charts of the current run

results/gastro100c_custom.json     the current run (100 charts, 495 diagnoses)
results/gastro100c_custom.xlsx     the same run in Excel


HOW TO RUN
----------
Run every command from this folder.

1. Look at the questions without calling Jev (free):
      python3 run_icd_direct_walk.py --dry-run --units inputs/gastro/gastro100c_units.json \
          --pointers inputs/custom_links.json --limit 2

2. Run a set of charts:
      export TYPESAFE_API_KEY=your_key_here
      python3 run_icd_direct_walk.py --units inputs/gastro/gastro100c_units.json \
          --pointers inputs/custom_links.json --workers 8 --out results/my_run.json

   All 1,500 charts:
      python3 run_icd_direct_walk.py --units inputs/gastro/gastro_all_units.json \
          --pointers inputs/custom_links.json --workers 8 --out results/all1500.json

   Leave out --pointers to run without the custom links.
   Other options: --limit N (first N diagnoses), --ids file.json (a list of diagnosis ids).

3. Score it:
      python3 score_category.py results/my_run.json --with-custom

   Drop --with-custom to score without the custom links.

4. Export to Excel:
      python3 export_run_excel.py results/my_run.json


WHAT THE SCORE MEANS
--------------------
The reference is the code the human coder kept on the claim.

- walk itself reached the coder's category: the category chosen at step 2 equals the coder's.
- CATEGORY in candidates: the coder's 3-character category is among the candidates offered at
  step 5. This is the headline figure.
- exact code in candidates: the coder's full code is among them.

Not scored: diagnoses the coder deleted, walks that ended with no entry (Gemini route),
API errors, and the listed extraction errors. Each is counted on the first line of the output.


CURRENT RESULT (results/gastro100c_custom.json)
-----------------------------------------------
100 charts never used before, 495 diagnoses, 431 kept by the coder and scored.

  walk itself reached the coder's category   397 / 431 = 92.1%
  coder's category in the candidates          409 / 431 = 94.9%   (94.0% without custom links)
  coder's exact code in the candidates        364 / 431 = 84.5%
  Gemini route / API errors                    0 / 0
  Cost: about $0.53 for the 100 charts, roughly 0.1 cent per diagnosis.


TIME AND COST
-------------
About 3 minutes and $0.50 per 100 charts with 8 workers. All 1,500 charts: roughly 40 minutes
and $8. Jev bills input tokens only, $0.042 per million.


KNOWN LIMITS
------------
- Jev refuses a question with more than 255 options. The category questions for infections
  (A00-B99), injuries (S00-T88) and external causes (V00-Y99) exceed it; a diagnosis sent there
  ends as an API error.
- Results vary slightly from run to run.
- The custom links were derived from coder data on these gastro charts. Do not reuse them for
  another client or specialty without review.
- Codes are FY2026. The tabular and index files need regenerating each October.
