import type { Content, Part } from "@google/genai";
import { z } from "zod";
import { getConfig } from "../../core/config";

export const ObservationSchema = z.object({
  url: z.string(),
  title: z.string(),
  gate: z.object({
    status: z.enum(["clinical", "not_clinical"]),
    kind: z.string(),
    setting: z.enum(["operative", "enm", "inpatient", "unknown", "none"]),
  }),
  blocks: z.array(z.object({ heading: z.string(), text: z.string() })).optional(),
  screenshot: z.string().optional(),
  checkSummary: z.string().optional(),
  /** Documents the provider attached. Shared by choice, so they are included whatever the page gate says. */
  attachments: z
    .array(z.object({ name: z.string(), sections: z.array(z.object({ name: z.string(), text: z.string() })) }))
    .optional(),
});

export type Observation = z.infer<typeof ObservationSchema>;

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Attached documents as text, shared within the same character budget as page text. */
export function attachmentText(obs: Observation): string {
  if (!obs.attachments?.length) return "";
  const max = getConfig().agent.max_page_chars;
  const docs = obs.attachments
    .map((a) => `### ${a.name}\n${a.sections.map((s) => `## ${s.name}\n${s.text}`).join("\n\n")}`)
    .join("\n\n")
    .slice(0, max);
  return `ATTACHED DOCUMENTS (shared by the provider: ${obs.attachments.map((a) => a.name).join(", ")})\n${docs}`;
}

/**
 * The parts the agent model sees for one observation. Privacy is enforced here as well as in
 * the extension: a closed gate sends no page text and no screenshot, whatever the client sent.
 */
export function observationParts(obs: Observation): Part[] {
  const attached = attachmentText(obs);
  if (obs.gate.status !== "clinical") {
    const gate = `OBSERVATION\nPrivacy gate: NOT CLINICAL. Nothing from this page is included.\nTab host: ${host(obs.url)}`;
    return [{ text: attached ? `${gate}\n\n${attached}` : gate }];
  }
  const max = getConfig().agent.max_page_chars;
  const pageText = (obs.blocks ?? [])
    .map((b) => (b.heading ? `## ${b.heading}\n${b.text}` : b.text))
    .join("\n\n")
    .slice(0, max);
  const lines = [
    "OBSERVATION",
    `Tab: ${obs.title} (${host(obs.url)})`,
    `Privacy gate: clinical, kind ${obs.gate.kind}`,
    obs.checkSummary ? `Latest documentation check:\n${obs.checkSummary}` : "No documentation check has run on this page yet.",
    pageText ? `PAGE TEXT\n${pageText}` : "No page text could be read; rely on the screenshot.",
    ...(attached ? [attached] : []),
  ];
  const parts: Part[] = [{ text: lines.join("\n\n") }];
  if (obs.screenshot) parts.push({ inlineData: { mimeType: "image/jpeg", data: obs.screenshot } });
  return parts;
}

function hasFunctionResponse(c: Content): boolean {
  return (c.parts ?? []).some((p) => p.functionResponse);
}

/**
 * Keep the history affordable: drop screenshots from all but the newest `keep_screenshots`
 * observations, cap the number of turns, and never start on an orphaned function response.
 */
export function trimHistory(history: Content[]): Content[] {
  const { keep_screenshots, max_history_turns } = getConfig().agent;
  let seenImages = 0;
  const lightened = [...history].reverse().map((c) => {
    if (c.role !== "user" || !(c.parts ?? []).some((p) => p.inlineData)) return c;
    seenImages++;
    if (seenImages <= keep_screenshots) return c;
    return { ...c, parts: (c.parts ?? []).map((p) => (p.inlineData ? { text: "[earlier screenshot removed]" } : p)) };
  });
  const trimmed = lightened.reverse().slice(-max_history_turns);
  while (trimmed.length && (trimmed[0]?.role !== "user" || hasFunctionResponse(trimmed[0]))) trimmed.shift();
  return trimmed;
}
