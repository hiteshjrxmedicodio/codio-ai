import { siteLabel } from "@/utils/chartSites";

interface Props {
  site: string;
  onAnswer: (remember: boolean) => void;
}

/**
 * Shown once, the first time a chart is recognised on a site. Saying yes means pages there are
 * read without the privacy gate having to recognise each one, which matters on screens that hold
 * little text and on PDFs.
 */
export function SiteOffer({ site, onAnswer }: Props) {
  return (
    <div className="mx-3 mb-2 flex flex-col gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2.5">
      <p className="text-[12.5px] leading-snug text-ink">
        Do you read charts on <span className="font-medium">{siteLabel(site)}</span>? Save it and Codio will read charts there straight away,
        PDFs included.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onAnswer(true)} className="rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-fg">
          Save this site
        </button>
        <button type="button" onClick={() => onAnswer(false)} className="rounded-full px-3 py-1 text-[12.5px] font-medium text-muted hover:bg-surface hover:text-ink">
          No thanks
        </button>
      </div>
    </div>
  );
}
