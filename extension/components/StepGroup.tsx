import { useState } from "react";
import type { ChatItem } from "@/utils/types";
import { Chevron } from "./icons";

interface Props {
  steps: ChatItem[];
  active: boolean;
}

/**
 * What the agent did, folded into one quiet line. While it works, the line shows the latest
 * step; afterwards it reads "Took N steps" and opens on click.
 */
export function StepGroup({ steps, active }: Props) {
  const [open, setOpen] = useState(false);
  const last = steps[steps.length - 1]?.text ?? "";
  const label = active ? last : `Took ${steps.length} step${steps.length > 1 ? "s" : ""}`;
  return (
    <div className="text-[12.5px] text-muted">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex max-w-full items-center gap-1.5 hover:text-ink">
        {active ? (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        ) : (
          <Chevron className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        )}
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <ol className="mt-1.5 flex flex-col gap-1 border-l border-line pl-3">
          {steps.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
