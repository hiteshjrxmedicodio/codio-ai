import { useCallback, useRef, useState } from "react";
import type { ChartId } from "./chartIds";
import { findChatById, type ChatSummary } from "./chatStore";

/**
 * Chart IDs shown on a chart are saved with the current chat or summary straight away. The one
 * question is when something was already saved under that ID: then the provider is offered to
 * open it, and saying no saves the ID on the current one instead.
 */
export type IdOffer = { kind: "open"; id: ChartId; match: ChatSummary };

export function useChartIdOffer(type: "chat" | "summary") {
  const [offer, setOffer] = useState<IdOffer | null>(null);
  /** IDs whose earlier record the provider chose not to open in this session. */
  const declined = useRef(new Set<string>());

  /**
   * Look at the IDs found on the page. `saved` are the IDs already kept on the current record;
   * `save` keeps a new one there. `openOnly` never saves, for when there is nothing yet to save to.
   */
  const consider = useCallback(
    async (found: ChartId[], saved: ChartId[], currentId: string, save: (id: ChartId) => void, openOnly = false) => {
      const id = found.find((f) => !saved.some((s) => s.value === f.value));
      if (!id) return;
      const match = declined.current.has(id.value) ? null : await findChatById(id.value, currentId, type);
      if (match) setOffer({ kind: "open", id, match });
      else if (!openOnly) save(id);
    },
    [type],
  );

  /** No to opening the earlier record. Returns the offer so the caller can save the ID here instead. */
  const decline = useCallback((): IdOffer | null => {
    const o = offer;
    if (o) declined.current.add(o.id.value);
    setOffer(null);
    return o;
  }, [offer]);

  const clear = useCallback(() => setOffer(null), []);

  return { offer, consider, decline, clear };
}
