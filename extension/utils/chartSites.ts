/**
 * Sites the provider told Codio they read charts on. On these, a page is read without the
 * privacy gate having to recognise it first (the gate still names the kind of note), which ends
 * the "not a chart" misses on screens that hold little text, and on PDFs, which show no text.
 * Sites are whole origins, so every chart, path and PDF served from one keeps working.
 */
const SITES_KEY = "codio-chart-sites";
/** Sites the provider said no to, so the offer is not repeated. */
const DECLINED_KEY = "codio-chart-sites-declined";

/**
 * The site a tab address belongs to. A blob: PDF belongs to the site that made it; local files
 * share one entry.
 */
export function siteOf(url: string): string | null {
  try {
    if (url.startsWith("file:")) return "file://";
    const u = new URL(url.startsWith("blob:") ? url.slice(5) : url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

/** What to show for a site: its host, or "Files on this computer". */
export function siteLabel(site: string): string {
  return site === "file://" ? "Files on this computer" : site.replace(/^https?:\/\//, "");
}

async function readList(key: string): Promise<string[]> {
  const stored = await browser.storage.local.get(key);
  return (stored[key] as string[] | undefined) ?? [];
}

export const listChartSites = () => readList(SITES_KEY);

export async function isChartSite(url: string): Promise<boolean> {
  const site = siteOf(url);
  return Boolean(site) && (await listChartSites()).includes(site as string);
}

export async function addChartSite(url: string): Promise<void> {
  const site = siteOf(url);
  if (!site) return;
  const sites = await listChartSites();
  if (!sites.includes(site)) await browser.storage.local.set({ [SITES_KEY]: [...sites, site] });
  const declined = (await readList(DECLINED_KEY)).filter((s) => s !== site);
  await browser.storage.local.set({ [DECLINED_KEY]: declined });
}

export async function removeChartSite(site: string): Promise<void> {
  await browser.storage.local.set({ [SITES_KEY]: (await listChartSites()).filter((s) => s !== site) });
}

export async function declineChartSite(url: string): Promise<void> {
  const site = siteOf(url);
  if (!site) return;
  const declined = await readList(DECLINED_KEY);
  if (!declined.includes(site)) await browser.storage.local.set({ [DECLINED_KEY]: [...declined, site] });
}

/** Offer to remember a site once: when a chart is recognised there and it is neither saved nor declined. */
export async function shouldOfferSite(url: string): Promise<boolean> {
  const site = siteOf(url);
  if (!site) return false;
  return !(await listChartSites()).includes(site) && !(await readList(DECLINED_KEY)).includes(site);
}
