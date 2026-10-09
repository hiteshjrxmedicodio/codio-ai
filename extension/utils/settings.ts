/**
 * Where the service runs. Fixed at build time (WXT_SERVICE_URL); a provider never sees or edits it.
 */
export const SERVICE_URL: string =
  (import.meta.env as unknown as Record<string, string | undefined>).WXT_SERVICE_URL || "http://127.0.0.1:8787";

/**
 * Defence in depth behind the navigation prompt's own rule: the content script refuses to list or
 * click any control whose visible label matches this. A safety rule, not a preference, so it is
 * not editable in the panel.
 */
export const BLOCKED_CONTROLS =
  "\\b(sign|submit|save|delete|remove|order|send|finali[sz]e|close encounter|discharge|approve|pay)\\b";

/** The provider's own choices, kept in browser.storage.local. */
export interface Preferences {
  /**
   * Standing permission to read: when on, a note is read and checked as soon as it opens, with no
   * question first. Off (the default): Codio asks before reading each note.
   */
  autoCheck: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { autoCheck: false };

const KEY = "codio-preferences";
/** Older builds stored the service address and an editable blocked-controls pattern here. */
const RETIRED_KEY = "cdi-assist-settings";

export async function loadPreferences(): Promise<Preferences> {
  const stored = await browser.storage.local.get(KEY);
  await browser.storage.local.remove(RETIRED_KEY);
  return { ...DEFAULT_PREFERENCES, ...((stored[KEY] as Partial<Preferences>) ?? {}) };
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await browser.storage.local.set({ [KEY]: prefs });
}
