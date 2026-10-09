/**
 * The report run (CDI → diagnoses and ICD-10 → procedures and CPT) on screen: CDI's card fills the
 * moment CDI finishes, then the ICD-10 and CPT pipeline cards each fill as their own part finishes.
 * Also the reply in the shapes the companion keeps, and the CDI and CPT cards' list and detail views.
 */
import { removeCard, type CardId } from "./companionUi/dock";
import { icdProgressCard, type CodedDiagnosis } from "./companionUi/icdCards";
import { cdiDetailCard, cdiListCard, cdiLoading, cptDetailCard, cptListCard, cptLoading, type CdiView, type CptView } from "./companionUi/runCards";
import { runIcdJob } from "./icdJob";

export interface RunView {
  cdi: CdiView;
  cpt: CptView;
}

type Page = { heading: string; text: string }[];
type CdiReply = {
  blocks: { heading: string; text: string }[];
  confidence: number;
  changed: number[];
  changes?: { index: number; kind: string; before: string; after: string; reason: string }[];
  flags?: { index: number; text: string; reason: string }[];
  error?: string;
};
type CptReply = Partial<CptView> & { error?: string; skipped?: string };

interface Reply {
  cdi?: CdiReply;
  /** `skipped`: turned off in the service's config (report_run), so only CDI ran for it. */
  icd?: { diagnoses?: CodedDiagnosis[]; engineError?: string; error?: string; skipped?: string };
  cpt?: CptReply;
  error?: string;
}

/** `page` is the report as read from the page, so CDI's card can show each section as written. */
function cdiView(c: CdiReply | undefined, page: Page): CdiView {
  // Every section CDI rewrote or left something in, in page order, with its own part of the trail.
  const shown = [...new Set([...(c?.changed ?? []), ...(c?.flags ?? []).map((f) => f.index)])].sort((a, b) => a - b);
  return {
    sections: shown.map((i) => ({
      heading: page[i]?.heading ?? "",
      original: page[i]?.text ?? "",
      cleaned: c?.blocks[i]?.text ?? "",
      changes: (c?.changes ?? []).filter((x) => x.index === i),
      flags: (c?.flags ?? []).filter((x) => x.index === i),
    })),
    total: page.filter((b) => b.text.trim()).length,
    confidence: c?.confidence ?? 0,
    error: c?.error,
  };
}

const cptView = (p: CptReply | undefined): CptView => ({
  off: Boolean(p?.skipped),
  status: p?.status ?? "",
  procedures: p?.procedures ?? [],
  codes: p?.codes ?? [],
  error: p?.error ?? (p?.codes ? undefined : "no result came back"),
});

/** `icd` is undefined when ICD-10 is turned off for this run, so no ICD-10 card is shown. */
export function readRun(r: Reply, page: Page): { icd?: { diagnoses: CodedDiagnosis[]; engineError?: string }; run: RunView } {
  if (r.error || !r.icd) throw new Error(r.error ?? "no result came back");
  const run = { cdi: cdiView(r.cdi, page), cpt: cptView(r.cpt) };
  if (r.icd.skipped) return { run };
  if (r.icd.error || !r.icd.diagnoses) throw new Error(r.icd.error ?? "no diagnoses came back");
  return { icd: { diagnoses: r.icd.diagnoses, engineError: r.icd.engineError }, run };
}

type Show = (html: string, where: CardId, focus?: boolean) => void;

/**
 * Run the report through the service and keep the cards in step with it: CDI cleaning first, in
 * the CDI card; once CDI is done its card fills and ICD-10 and CPT start, each card filling the
 * moment its part finishes. Returns the whole reply.
 */
export function runReport(page: Page, show: Show): Promise<Reply> {
  openCdi = openProc = null;
  show(cdiLoading(), "cdi");
  let shown = "";
  return runIcdJob<Reply>(
    page,
    // CDI's step shows in the CDI card, and "done" never opens an ICD-10 card the run may not have.
    (step) => step.step !== "cdi" && step.step !== "done" && show(icdProgressCard(step), "icd", false),
    "codes",
    (partial) => {
      const p = partial as Reply;
      if (p.cdi && !shown.includes("cdi")) {
        shown += "cdi";
        show(cdiListCard(cdiView(p.cdi, page)), "cdi", false);
        if (!p.cpt) show(cptLoading(), "cpt", false);
      }
      if (p.cpt && !shown.includes("cpt")) {
        shown += "cpt";
        if (p.cpt.skipped) removeCard("cpt");
        else show(cptListCard(cptView(p.cpt)), "cpt", false);
      }
    },
  );
}

/** Which section and which procedure are open; null shows the list. */
let openCdi: number | null = null;
let openProc: number | null = null;

/** Both cards from a finished run (a new one, or one brought back after a refresh). */
export function renderRun(show: Show, run: RunView, focus = false): void {
  const section = openCdi === null ? undefined : run.cdi.sections[openCdi];
  show(section ? cdiDetailCard(section) : cdiListCard(run.cdi), "cdi", focus && openCdi !== null);
  if (run.cpt.off) removeCard("cpt");
  else show(openProc === null ? cptListCard(run.cpt) : cptDetailCard(run.cpt, openProc), "cpt", focus && openProc !== null);
}

/** The CDI and CPT card buttons. True when the click was one of theirs. */
export function runAction(action: string | undefined, index: number, run: RunView | undefined, show: Show): boolean {
  if (!run || !action || !["cdi", "cdi-back", "proc", "cpt-back"].includes(action)) return false;
  if (action === "cdi" || action === "cdi-back") {
    openCdi = action === "cdi" ? index : null;
    const section = openCdi === null ? undefined : run.cdi.sections[openCdi];
    show(section ? cdiDetailCard(section) : cdiListCard(run.cdi), "cdi", true);
  } else {
    openProc = action === "proc" ? index : null;
    show(openProc === null ? cptListCard(run.cpt) : cptDetailCard(run.cpt, openProc), "cpt", true);
  }
  return true;
}
