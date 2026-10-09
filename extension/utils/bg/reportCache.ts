/**
 * The companion's last result per report page, kept for the browser session only
 * (storage.session lives in memory and is gone when the browser closes). A page refresh wipes the
 * page's own memory; this lets the suggestions come straight back instead of disappearing.
 */
const PREFIX = "codio-report:";
const INDEX = "codio-report-index";
const MAX_PAGES = 20;

export async function rememberReport(key: string, entry: unknown): Promise<void> {
  const stored = await browser.storage.session.get(INDEX);
  const index = ((stored[INDEX] as string[] | undefined) ?? []).filter((k) => k !== key);
  index.push(key);
  const dropped = index.splice(0, Math.max(0, index.length - MAX_PAGES));
  if (dropped.length) await browser.storage.session.remove(dropped.map((k) => PREFIX + k));
  await browser.storage.session.set({ [PREFIX + key]: entry, [INDEX]: index });
}

export async function recallReport(key: string): Promise<unknown> {
  const stored = await browser.storage.session.get(PREFIX + key);
  return stored[PREFIX + key] ?? null;
}
