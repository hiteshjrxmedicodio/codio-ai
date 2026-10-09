import { useEffect, useRef } from "react";
import type { ChatItem } from "@/utils/types";
import { EmptyState } from "./EmptyState";
import { MessageItem } from "./MessageItem";
import { StepGroup } from "./StepGroup";

interface Props {
  items: ChatItem[];
  busy: boolean;
  canRead: boolean;
  onPick: (text: string) => void;
  onAnswer: (id: string, allow: boolean, always?: boolean) => void;
}

type Row = { kind: "item"; item: ChatItem } | { kind: "steps"; steps: ChatItem[] };

/** Consecutive steps fold into one group so the conversation stays readable. */
function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const prev = rows[rows.length - 1];
    if (item.role === "step") {
      if (prev?.kind === "steps") prev.steps.push(item);
      else rows.push({ kind: "steps", steps: [item] });
    } else {
      rows.push({ kind: "item", item });
    }
  }
  return rows;
}

export function ChatView({ items, busy, canRead, onPick, onAnswer }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const rows = toRows(items);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, busy]);

  const hasConversation = items.some((i) => i.role === "user" || i.role === "assistant");
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3" aria-live="polite">
      {!hasConversation && <EmptyState canRead={canRead} onPick={onPick} />}
      {rows.map((row, i) =>
        row.kind === "steps" ? (
          <StepGroup key={row.steps[0]?.id} steps={row.steps} active={busy && i === rows.length - 1} />
        ) : (
          <MessageItem key={row.item.id} item={row.item} onAnswer={onAnswer} />
        ),
      )}
      {busy && rows[rows.length - 1]?.kind !== "steps" && (
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          Thinking
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
