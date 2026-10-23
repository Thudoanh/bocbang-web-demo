import type { ReactNode } from "react";

export type RealtimeTranslation = { text: string; sourceLanguage: string; targetLanguage: string };

export function TranscriptColumnsHeader({ translated }: { translated: boolean }) {
  if (!translated) return null;
  return <div className="transcript-columns-heading"><h3>Transcript gốc</h3><h3>Bản dịch</h3></div>;
}

/** One grid row per segment keeps both columns aligned without independent scrolling. */
export function TranscriptPair({ translated, translation, speaker, timestamp, unconfirmed = false, live = false, emptyMessage, children }: {
  translated: boolean; translation?: RealtimeTranslation; speaker: string; timestamp: string;
  unconfirmed?: boolean; live?: boolean; emptyMessage?: string; children: ReactNode;
}) {
  return <div className={`transcript-pair${translated ? " is-translated" : ""}${live ? " is-live" : ""}`}>
    {children}
    {translated && <article className="transcript-translation" aria-label={`Bản dịch · ${speaker} · ${timestamp}`}>
      <header><strong>{speaker}</strong><small>{timestamp}</small>{translation && !unconfirmed && <span className="translation-language">{translation.targetLanguage.toUpperCase()}</span>}</header>
      {translation && !unconfirmed ? <p lang={translation.targetLanguage}>{translation.text}</p> : <p className="translation-placeholder">{emptyMessage ?? (unconfirmed ? "Lời nói chưa được xác nhận; chưa có bản dịch." : "Chưa có bản dịch cho đoạn này.")}</p>}
    </article>}
  </div>;
}
