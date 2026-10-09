# Engine CDI prompts (reference only)

Copied 2026-10-09 from the Codio engine (`next-gen-engine`), read-only reference for the CDI prompts
in `service/prompts/`. Nothing here is loaded at runtime, and these files do not follow
`docs/PROMPT_STANDARD.md` (they carry examples, lists and JSON shapes); the service prompts take their
substance and restate it as instructions.

| File | Engine source | Used in |
|---|---|---|
| `p001_2_cleaning_cdi.txt` | `uat` · chart_pre_processing | `coding/p_cdi_normalize.txt` (preprocessing) |
| `p060_ip_record_standardization.txt` | `feat/inpatient-engine` · cdi | `coding/p_cdi_normalize.txt` (preprocessing) |
| `p057_cdi_reasoning.txt` | `feat/inpatient-engine` · cdi | `cdi/p_inc_unaddressed.txt`, `cdi/p_con_contradictions.txt` |
| `p058_cdi_clinical_validation.txt` | `feat/inpatient-engine` · cdi | `cdi/p_val_validation.txt` |
| `p059_cdi_query_draft.txt` | `feat/inpatient-engine` · cdi | `cdi/p_fix_guidance.txt` |
| `p061_ip_record_completeness.txt` | `feat/inpatient-engine` · cdi | `cdi/p_inc_unaddressed.txt` |
| `p062_ip_record_integrity.txt` | `feat/inpatient-engine` · cdi | `cdi/p_con_contradictions.txt`, `cdi/p_gate_criticality.txt` |
| `p083_ip_g3_1_clinical_validity.txt`, `p084_ip_g3_2_query_generation.txt` | `feat/inpatient-engine` · inpatient | reference |
| `s2_completeness.txt`, `s3_integrity.txt` | `uat` · chart_pre_processing | reference |

Engine commits: `feat/inpatient-engine` 0a49081a, `uat` 0a3145dd.
