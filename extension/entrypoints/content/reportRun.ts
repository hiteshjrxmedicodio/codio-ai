/**
 * The report run (CDI → diagnoses and ICD-10 → procedures and CPT) on screen: CDI's card fills the
 * moment CDI finishes, then the ICD-10 and CPT pipeline cards each fill as their own part finishes.
 * Also the reply in the shapes the companion keeps, and the CDI and CPT cards' list and detail views.
 */
import type { CardId } from "./companionUi/dock";
import { icdProgressCard, type CodedDiagnosis } from "./companionUi/icdCards";
import { cdiDetailCard, cdiListCard, cdiLoading, cptDetailCard, cptListCard, cptLoading, type CdiView, type CptView } from "./companionUi/runCards";
import { runIcdJob } from "./icdJob";

export interface RunView {
  cdi: CdiView;
  cpt: CptView;
}

type Page = { heading: string; text: string }[];
type CdiReply = { blocks: { heading: string; text: string }[]; confidence: number; changed: number[]; error?: string };
type CptReply = Partial<CptView> & { error?: string };

interface Reply {
  cdi?: CdiReply;
  icd?: { diagnoses?: CodedDiagnosis[]; engineError?: string; error?: string };
  cpt?: CptReply;
  error?: string;
}

/** `page` is the report as read from the page, so CDI's card can show each section as written. */
function cdiView(c: CdiReply | undefined, page: Page): CdiView {
  return {
    sections: (c?.changed ?? []).map((i) => ({ heading: page[i]?.heading ?? "", original: page[i]?.text ?? "", cleaned: c?.blocks[i]?.text ?? "" })),
    total: page.filter((b) => b.text.trim()).length,
    confidence: c?.confidence ?? 0,
    error: c?.error,
  };
}

const cptView = (p: CptReply | undefined): CptView => ({
  status: p?.status ?? "",
  procedures: p?.procedures ?? [],
  codes: p?.codes ?? [],
  error: p?.error ?? (p?.codes ? undefined : "no result came back"),
});

export function readRun(r: Reply, page: Page): { icd: { diagnoses: CodedDiagnosis[]; engineError?: string }; run: RunView } {
  if (r.error || !r.icd) throw new Error(r.error ?? "no result came back");
  if (r.icd.error || !r.icd.diagnoses) throw new Error(r.icd.error ?? "no diagnoses came back");
  return { icd: { diagnoses: r.icd.diagnoses, engineError: r.icd.engineError }, run: { cdi: cdiView(r.cdi, page), cpt: cptView(r.cpt) } };
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
    (step) => step.step !== "cdi" && show(icdProgressCard(step), "icd", false),
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
        show(cptListCard(cptView(p.cpt)), "cpt", false);
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
  show(openProc === null ? cptListCard(run.cpt) : cptDetailCard(run.cpt, openProc), "cpt", focus && openProc !== null);
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
