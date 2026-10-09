import { useEffect, useMemo, useState } from "react";
import { ChatView } from "@/components/ChatView";
import { Composer } from "@/components/Composer";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ChartIdOffer } from "@/components/ChartIdOffer";
import { DictationCard } from "@/components/DictationCard";
import { SiteOffer } from "@/components/SiteOffer";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SummaryView } from "@/components/SummaryView";
import { TopBar } from "@/components/TopBar";
import { api } from "@/utils/api";
import type { AgentSettings } from "@/utils/types";
import { useDictation } from "@/utils/useDictation";
import { useChat } from "@/utils/useChat";
import { useReportSummary } from "@/utils/useReportSummary";

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [sheet, setSheet] = useState<"none" | "settings" | "history">("none");
  const [draft, setDraft] = useState("");
  // summary_only pauses chat, the automatic check and navigation: only the report summary runs.
  const summaryOnly = Boolean(settings?.features?.summary_only);
  const dictation = useDictation(settings?.dictation?.segment_seconds);
  const chat = useChat(summaryOnly ? null : settings);
  const report = useReportSummary(summaryOnly ? settings : null);
  const limits = useMemo(
    () => (settings ? { maxChats: settings.agent.history_max_chats, keepDays: settings.agent.history_keep_days } : null),
    [settings],
  );

  async function connect() {
    try {
      await api.health();
      setSettings(await api.settings());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }

  useEffect(() => {
    connect();
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      <TopBar
        online={online}
        onNewChat={summaryOnly ? undefined : chat.newChat}
        onHistory={() => setSheet("history")}
        onSettings={() => setSheet("settings")}
        onRetry={connect}
      />
      {sheet === "settings" && <SettingsPanel online={online} onClose={() => setSheet("none")} />}
      {sheet === "history" && limits && (
        <HistoryPanel
          limits={limits}
          type={summaryOnly ? "summary" : "chat"}
          currentId={summaryOnly ? report.recordId : chat.chatId}
          onOpen={(id) => {
            void (summaryOnly ? report.openSaved(id) : chat.openChat(id));
            setSheet("none");
          }}
          onDeletedCurrent={summaryOnly ? () => undefined : chat.newChat}
          onNewChat={
            summaryOnly
              ? undefined
              : () => {
                  chat.newChat();
                  setSheet("none");
                }
          }
          onClose={() => setSheet("none")}
        />
      )}
      {online === false && (
        <p className="mx-3 rounded-xl bg-surface px-3 py-2 text-[12.5px] text-muted">
          Codio is offline right now. Tap the dot next to the name to try again.
        </p>
      )}
      {summaryOnly ? (
        <>
          <div key={`${report.viewKey}|${report.phase}`} className="animate-fade-in flex min-h-0 flex-1 flex-col">
          <SummaryView
            phase={report.phase}
            steps={report.steps}
            summary={report.summary}
            review={report.review}
            icd={report.icd}
            error={report.error}
            onAgain={report.again}
            onReadAnyway={report.readAnyway}
            onAllow={report.allow}
            kind={report.kind}
            background={Boolean(settings?.report?.background_tab)}
            qa={report.qa}
            asking={report.asking}
          />
          </div>
          <DictationCard d={dictation} />
          {report.idOffer && <ChartIdOffer offer={report.idOffer} noun="summary" onAccept={() => report.answerIdOffer(true)} onDecline={() => report.answerIdOffer(false)} />}
          <Composer busy={report.asking} gate={report.phase === "permission" ? null : report.gate} draft={draft} onDraft={setDraft} onSend={(text) => void report.ask(text)} onStop={() => undefined} reportMode onLiveTranscribe={dictation.phase === "idle" ? dictation.start : undefined} />
        </>
      ) : (
        <>
          <ChatView
            items={chat.items}
            busy={chat.busy}
            canRead={chat.gate?.status === "clinical"}
            onPick={chat.send}
            onAnswer={chat.answerAsk}
          />
          <DictationCard d={dictation} />
          {chat.idOffer && <ChartIdOffer offer={chat.idOffer} noun="chat" onAccept={() => chat.answerIdOffer(true)} onDecline={() => chat.answerIdOffer(false)} />}
          {chat.siteOffer && <SiteOffer site={chat.siteOffer} onAnswer={chat.answerSiteOffer} />}
          <Composer busy={chat.busy} gate={chat.gate} draft={draft} onDraft={setDraft} onSend={chat.send} onStop={chat.stop} onLiveTranscribe={dictation.phase === "idle" ? dictation.start : undefined} />
        </>
      )}
    </div>
  );
}
