import { SERVICE_URL } from "../settings";
import type { AgentSettings } from "../types";

/** POST to the local Codio service. Errors come back as { error } so the page can show a message. */
export async function post<T>(path: string, body: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? (data as T) : { error: (data as { error?: string }).error ?? `Service returned ${res.status}` };
  } catch (err) {
    return { error: `Codio's service isn't reachable (${String(err)})` };
  }
}

/** GET from the local Codio service, with the same { error } shape as post. */
export async function get<T>(path: string): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${SERVICE_URL}${path}`);
    const data = await res.json().catch(() => ({}));
    return res.ok ? (data as T) : { error: (data as { error?: string }).error ?? `Service returned ${res.status}` };
  } catch (err) {
    return { error: `Codio's service isn't reachable (${String(err)})` };
  }
}

interface CompanionSettings {
  enabled: boolean;
  min_hits: number;
  clinical_hints: string[];
}

type ServiceSettings = AgentSettings & { companion?: CompanionSettings };

let cached: Promise<ServiceSettings | null> | null = null;

/** The service's settings, fetched once per worker life (again after a failure). */
export function serviceSettings(): Promise<ServiceSettings | null> {
  cached ??= fetch(`${SERVICE_URL}/v1/agent/settings`)
    .then((r) => r.json() as Promise<ServiceSettings>)
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}

/** The companion's part of the settings. */
export const companionSettings = (): Promise<CompanionSettings | null> => serviceSettings().then((s) => s?.companion ?? null);
