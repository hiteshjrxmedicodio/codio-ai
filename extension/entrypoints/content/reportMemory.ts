import { reportKey } from "@/utils/reportKey";

/**
 * What the companion remembers about the report page it is on: the provider's answer to reading
 * it (this tab's session only) and a fingerprint of its words. The page key is the report's key
 * (utils/reportKey: the full address, so each report in a single-page EMR is asked about on its
 * own), the same key the extension's session copy of a read is kept under.
 */
export const pageKey = (): string => reportKey(location.href);
export function remember(answer: "allowed" | "declined"): void {
  try {
    sessionStorage.setItem(pageKey(), answer);
  } catch {
    /* storage blocked: ask again next time */
  }
}
export function consent(): string | null {
  try {
    return sessionStorage.getItem(pageKey());
  } catch {
    return null;
  }
}

/**
 * The report's words as a short fingerprint. Digits are left out so a ticking timer or counter
 * does not count as a change; any edit to the note's words does.
 */
export async function fingerprint(blocks: { heading: string; text: string }[]): Promise<string> {
  const text = blocks.map((b) => `${b.heading}\n${b.text}`).join("\n").replace(/\d+/g, "").replace(/\s+/g, " ");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
