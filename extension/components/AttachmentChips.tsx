import type { AttachedDoc, PendingFile } from "@/utils/types";
import { Close, Doc } from "./icons";

/** Files waiting in the composer, each with its reading state and a remove button. */
export function PendingChips({ files, onRemove }: { files: PendingFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
      {files.map((f) => (
        <span
          key={f.id}
          title={f.error ?? f.name}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] ${
            f.status === "error" ? "border-coding/30 bg-coding/5 text-coding" : "border-line bg-surface text-ink"
          }`}
        >
          {f.status === "reading" ? (
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted/30 border-t-muted" aria-hidden="true" />
          ) : (
            <Doc className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="max-w-[160px] truncate">{f.name}</span>
          <span className="shrink-0 text-muted">{f.status === "reading" ? "Reading…" : f.status === "error" ? "Couldn't read" : ""}</span>
          <button type="button" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`} className="shrink-0 rounded p-0.5 text-muted hover:text-ink">
            <Close className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Documents shown on a sent message. */
export function SentChips({ docs }: { docs: AttachedDoc[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {docs.map((d) => (
        <span key={d.name} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-[12px] text-ink">
          <Doc className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="truncate">{d.name}</span>
        </span>
      ))}
    </div>
  );
}
