/**
 * The key one report is remembered under: the provider's answer to reading it, its session copy and
 * its coding job. It is the page's full address, query and hash included, because single-page EMRs
 * often show every report under one path and tell them apart only by a query (?chart=…) or a hash
 * route (#/chart/…); a key without them let one "Code it" code every report under that path. In
 * Codio's PDF viewer, one extension page for every PDF, it is the PDF's address instead.
 */
export function reportKey(href: string): string {
  const u = new URL(href);
  const file = u.protocol === "chrome-extension:" ? u.searchParams.get("file") : null;
  return `codio-consent:${file ? file.split(/[?#]/)[0] : `${u.origin}${u.pathname}${u.search}${u.hash}`}`;
}
