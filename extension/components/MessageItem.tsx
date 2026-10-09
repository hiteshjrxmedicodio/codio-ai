import type { ChatItem } from "@/utils/types";
import { SentChips } from "./AttachmentChips";
import { RichText } from "./RichText";
import { SuggestionCard } from "./SuggestionCard";

interface Props {
  item: ChatItem;
  onAnswer: (id: string, allow: boolean, always?: boolean) => void;
}

/** Your messages sit in a soft bubble on the right; the assistant writes plain text, like a document. */
export function MessageItem({ item, onAnswer }: Props) {
  if (item.role === "status") {
    return (
      <p className="text-center text-[12px] text-muted">{item.text}</p>
    );
  }

  if (item.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {item.attachments?.length ? <SentChips docs={item.attachments} /> : null}
        {item.text && <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-surface px-3.5 py-2 text-ink">{item.text}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {item.text && <RichText text={item.text} />}
      {item.ask && !item.ask.answered && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAnswer(item.id, true)} className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg">
            Read this page
          </button>
          <button type="button" onClick={() => onAnswer(item.id, true, true)} className="rounded-full border border-accent/40 px-3.5 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/5">
            Always on this site
          </button>
          <button type="button" onClick={() => onAnswer(item.id, false)} className="rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink hover:bg-surface">
            Not now
          </button>
        </div>
      )}
      {item.check && (
        <div className="flex flex-col gap-2">
          {item.check.suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} sections={item.check?.sections ?? []} setting={item.setting ?? "unknown"} />
          ))}
          {item.check.errors.length > 0 && <p className="text-[12px] text-muted">Some checks couldn't run this time.</p>}
        </div>
      )}
    </div>
  );
}
