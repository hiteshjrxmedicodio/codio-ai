import type { SavedDiagnosis } from "@/utils/types";

const STATUS: Record<string, string> = { historical: "History only", uncertain: "Uncertain", ruled_out: "Ruled out" };

/**
 * The ICD codes the companion predicted on the page, for when the provider opens the panel for
 * more: each diagnosis phrase with its code, or why it has none. The trail behind each code is
 * opened on the page, by clicking the phrase.
 */
export function IcdList({ icd }: { icd: { diagnoses: SavedDiagnosis[]; engineError?: string } }) {
  const coded = icd.diagnoses.filter((d) => d.code).length;
  return (
    <section className="mb-5 flex flex-col gap-2">
      <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">
        ICD-10 codes · {coded} of {icd.diagnoses.length} coded
      </p>
      {icd.diagnoses.map((d, i) => (
        <article key={i} className="flex items-start gap-3 rounded-xl border border-line bg-raised px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-ink">{d.phrase}</p>
            {d.code ? (
              <p className="mt-0.5 text-[12.5px] text-muted">{d.description}</p>
            ) : (
              <p className="mt-0.5 text-[12.5px] text-muted">{STATUS[d.status] ?? d.reviewReason ?? "Needs review"}</p>
            )}
          </div>
          {d.code && <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-1 font-mono text-[12.5px] font-bold text-brand">{d.code}</span>}
        </article>
      ))}
      {icd.engineError && <p className="text-[12px] text-muted">Codes were unavailable: {icd.engineError}</p>}
    </section>
  );
}
