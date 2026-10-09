import { useEffect, useState, type ReactNode } from "react";
import { openMicSettings, requestMicAccess } from "@/utils/micAccess";
import { listChartSites, removeChartSite, siteLabel } from "@/utils/chartSites";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences, type Preferences } from "@/utils/settings";
import { ArrowLeft, Check, Close, Globe, Info, Mic, Shield, Signal, Sparkle } from "./icons";

interface Props {
  online: boolean | null;
  onClose: () => void;
}

type MicAccess = PermissionState | "unknown";
type Tone = "ok" | "warn" | "bad" | "neutral";

/**
 * Settings as grouped cards on the beige page: an icon, a title, one line of help and the
 * control on the right of each row. Only choices a provider would make; each saves on change.
 */
export function SettingsPanel({ online, onClose }: Props) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [mic, setMic] = useState<MicAccess>("unknown");
  const [sites, setSites] = useState<string[]>([]);

  useEffect(() => {
    loadPreferences().then(setPrefs);
    listChartSites().then(setSites).catch(() => setSites([]));
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => {
        setMic(p.state);
        p.onchange = () => setMic(p.state);
      })
      .catch(() => setMic("unknown"));
  }, []);

  function update(next: Preferences) {
    setPrefs(next);
    void savePreferences(next);
  }

  const connection: [string, Tone] = online === null ? ["Connecting", "neutral"] : online ? ["Connected", "ok"] : ["Offline", "bad"];

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg px-2">
        <button type="button" onClick={onClose} aria-label="Back to chat" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink">
          <ArrowLeft />
        </button>
        <span className="text-[15px] font-semibold text-brand">Settings</span>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
        <Group title="Documentation check">
          <Row
            icon={<Sparkle />}
            title="Read notes without asking"
            help="On: each note is read and checked as soon as it opens. Off: Codio asks before reading."
            control={<Switch label="Read notes without asking" checked={prefs.autoCheck} onChange={(autoCheck) => update({ ...prefs, autoCheck })} />}
          />
        </Group>

        <Group title="Chart sites">
          {sites.length === 0 ? (
            <Row icon={<Globe />} title="No sites saved yet" help="When Codio recognises a chart, it offers to save that site. Pages on a saved site are read straight away, PDFs included." />
          ) : (
            sites.map((site) => (
              <Row
                key={site}
                icon={<Globe />}
                title={siteLabel(site)}
                help="Charts here are read straight away"
                control={
                  <button
                    type="button"
                    aria-label={`Remove ${siteLabel(site)}`}
                    title="Remove"
                    onClick={() => removeChartSite(site).then(() => setSites((s) => s.filter((x) => x !== site)))}
                    className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-coding"
                  >
                    <Close />
                  </button>
                }
              />
            ))
          )}
        </Group>

        <Group title="Voice">
          <Row
            icon={<Mic />}
            title="Talk to Codio"
            help={mic === "denied" ? "Blocked. Open Chrome's settings to allow Codio." : "Speak instead of typing. Codio writes it down for you."}
            control={
              mic === "granted" ? (
                <Pill tone="ok">Allowed</Pill>
              ) : mic === "denied" ? (
                <button type="button" onClick={openMicSettings} className="shrink-0 rounded-full border border-coding/30 bg-coding/5 px-3.5 py-1.5 text-[12.5px] font-medium text-coding hover:bg-coding/10">Open settings</button>
              ) : (
                <button type="button" onClick={() => void requestMicAccess().then((a) => setMic(a === "granted" ? "granted" : "denied"))} className="shrink-0 rounded-full border border-line bg-bg px-3.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-surface">
                  Set up
                </button>
              )
            }
          />
        </Group>

        <Group title="Privacy">
          <div className="flex gap-3 px-3.5 py-3">
            <IconBadge><Shield /></IconBadge>
            <ul className="flex flex-col gap-2 text-[13px] text-ink">
              <Assurance>Reads a page only when it's a patient chart, it's on a chart site you saved, or you say it can.</Assurance>
              <Assurance>Never signs, saves, orders or changes anything in the record.</Assurance>
            </ul>
          </div>
        </Group>

        <Group title="About">
          <Row icon={<Signal />} title="Service" control={<Pill tone={connection[1]}>{connection[0]}</Pill>} />
          <Row icon={<Info />} title="Version" control={<span className="text-[13px] tabular-nums text-muted">{browser.runtime.getManifest().version}</span>} />
        </Group>
      </div>

      <footer className="shrink-0 border-t border-line px-4 py-2.5 text-center text-[11px] text-muted">
        <span className="font-medium text-brand">MediCodio AI © 2026. All Rights Reserved</span> · www.medicodio.ai
      </footer>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">{children}</div>
    </section>
  );
}

function IconBadge({ children }: { children: ReactNode }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface text-ink/70">{children}</span>;
}

function Row({ icon, title, help, control }: { icon: ReactNode; title: string; help?: string; control?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <IconBadge>{icon}</IconBadge>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        {help && <span className="text-[12px] leading-snug text-muted">{help}</span>}
      </div>
      {control}
    </div>
  );
}

const TONE: Record<Tone, string> = {
  ok: "bg-ok/12 text-ok",
  warn: "bg-denial/12 text-denial",
  bad: "bg-coding/12 text-coding",
  neutral: "bg-surface text-muted",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

function Assurance({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 text-ok"><Check /></span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}
