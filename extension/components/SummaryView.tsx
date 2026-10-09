import type { ReactNode } from "react";
import type { ReportQA, ReportSummary, SavedDiagnosis, SavedReview } from "@/utils/types";
import type { SummaryPhase } from "@/utils/useReportSummary";
import { Check, Doc, Lock } from "./icons";
import { IcdList } from "./IcdList";
import { ReviewList } from "./ReviewList";
import { RichText } from "./RichText";

interface Props {
  phase: SummaryPhase;
  steps: string[];
  summary: ReportSummary | null;
  /** The review done on the page by the companion, when there is one. */
  review?: SavedReview | null;
  /** The ICD codes the companion predicted on the page, when there are any. */
  icd?: { diagnoses: SavedDiagnosis[]; engineError?: string } | null;
  error: string;
  onAgain: () => void;
  onReadAnyway: () => void;
  /** The provider's yes to reading the open report. */
  onAllow: () => void;
  /** The kind of note the privacy gate named, for the permission question. */
  kind: string;
  /** Reading happens in a background copy of the tab, so the provider's screen does not move. */
  background?: boolean;
  qa: ReportQA[];
  asking: boolean;
}

const KIND: Record<string, string> = { operative: "A procedure note", enm: "A visit note", inpatient: "A hospital note", other_clinical: "A clinical page" };

/** Summary-only mode: one screen that asks to read the open report, then lists its fields. */
export function SummaryView({ phase, steps, summary, review, icd, error, onAgain, onReadAnyway, onAllow, kind, background = false, qa, asking }: Props) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
      {phase === "idle" && <Centered title="Open a report" body="I'll read the whole report and tell you what each field contains." />}

      {phase === "not_report" && (
        <Centered title="This isn't a medical report" body="So I won't read this page." icon={<Lock className="h-5 w-5" />}>
          <button type="button" onClick={onReadAnyway} className="mt-3 text-[13px] font-medium text-accent hover:underline">
            Read it anyway
          </button>
        </Centered>
      )}

      {phase === "permission" && (
        <Centered
          title={`${KIND[kind] ?? "A report"} is open`}
          body={
            background
              ? "May I read it? I'll read a copy in a tab next to this one, so your screen stays where it is and you can keep working. I won't click, type or change anything."
              : "May I read it? I'll scroll through this report from top to bottom to read every field, then summarise it. I won't click, type or change anything."
          }
        >
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onAllow} className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-fg">
              Read this report
            </button>
          </div>
          <p className="mt-3 text-[12px] text-muted">Nothing on your screen moves until you say yes.</p>
        </Centered>
      )}

      {phase === "reading" && <Reading steps={steps} />}

      {phase === "error" && (
        <Centered title="I couldn't read this report" body={error}>
          <button type="button" onClick={onAgain} className="mt-3 rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-fg">
            Try again
          </button>
        </Centered>
      )}

      {phase === "done" && icd && <IcdList icd={icd} />}
      {phase === "done" && review && <ReviewList review={review} />}
      {phase === "done" && summary && <Summary summary={summary} onAgain={onAgain} />}

      {(qa.length > 0 || asking) && (
        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4" aria-live="polite">
          {qa.map((item, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-surface px-3.5 py-2 text-ink">{item.q}</p>
              </div>
              <RichText text={item.a} />
            </div>
          ))}
          {asking && (
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              Looking in the report
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Centered({ title, body, icon, children }: { title: string; body: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="m-auto flex max-w-[300px] flex-col items-center text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface text-ink/70">{icon ?? <Doc className="h-5 w-5" />}</span>
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[13px] text-muted">{body}</p>
      {children}
    </div>
  );
}

function Reading({ steps }: { steps: string[] }) {
  return (
    <div className="m-auto w-full max-w-[320px]">
      <p className="mb-3 text-center text-[15px] font-semibold text-ink">Reading the whole report…</p>
      <ol className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3 text-[12.5px]">
        {steps.map((s, i) => {
          const current = i === steps.length - 1;
          return (
            <li key={i} className={`flex items-center gap-2 ${current ? "text-ink" : "text-muted"}`}>
              {current ? (
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted/30 border-t-accent" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
              )}
              {s}
            </li>
          );
        })}
        {!steps.length && <li className="text-muted">Starting…</li>}
      </ol>
    </div>
  );
}

function Summary({ summary, onAgain }: { summary: ReportSummary; onAgain: () => void }) {
  const n = summary.fields.length;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{summary.report_type}</p>
        <p className="mt-1 text-ink">{summary.overview}</p>
        <p className="mt-2 text-[13px] text-muted">
          This report contains <span className="font-semibold text-ink">{n} field{n === 1 ? "" : "s"}</span>:
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {summary.fields.map((f, i) => (
            <a key={i} href={`#field-${i}`} className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-[12px] text-ink hover:bg-surface">
              {f.name}
            </a>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-2">
        {summary.fields.map((f, i) => (
          <article key={i} id={`field-${i}`} className="rounded-xl border border-line bg-raised p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold text-ink">{f.name}</h3>
              {f.unlabelled && <span className="shrink-0 text-[11px] text-muted">no heading on report</span>}
            </div>
            <p className="mt-1 text-[13.5px] text-ink">{f.summary}</p>
            {f.key_details.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5 border-l-2 border-line pl-2.5 text-[12.5px] text-muted">
                {f.key_details.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      {summary.empty_fields.length > 0 && (
        <p className="text-[12.5px] text-muted">
          <span className="font-medium text-ink">Present but empty:</span> {summary.empty_fields.join(", ")}
        </p>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          {summary.coverage.reachedEnd ? <Check className="h-3.5 w-3.5 text-ok" /> : <span className="h-2 w-2 rounded-full bg-denial" />}
          {summary.coverage.reachedEnd ? `Read to the end · ${summary.coverage.method}` : `May not include the end · ${summary.coverage.method}`}
        </span>
        <button type="button" onClick={onAgain} className="shrink-0 font-medium text-accent hover:underline">
          Read again
        </button>
      </footer>
    </div>
  );
}
