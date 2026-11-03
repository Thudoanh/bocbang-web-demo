import { useEffect, useRef, useState } from "react";
import { config } from "../app/config";
import { sharesApi } from "../api/endpoints";
import type { Meeting, Segment } from "../types/domain";
import { browserDraftLabel, interruptBrowserSession, restoreBrowserDrafts, finishLiveTranscript, updateLiveTranscript, type LiveTranscript } from "../realtime/liveTranscript";
import { BrowserTranscriptText } from "../components/BrowserTranscriptText";

type LiveSegment = {
  logical_segment_id: string;
  speaker_name?: string;
  speaker_label?: string;
  start_ms: number;
  end_ms: number;
  text: string;
  translation?: string;
};

const isUuid = (str?: string) =>
  Boolean(str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim()));

function resolveSpeakerName(
  speakerName?: string,
  speakerLabel?: string,
  speakerId?: string,
  speakerMap: Record<string, string> = {}
): string {
  if (speakerName && !isUuid(speakerName) && !speakerName.toLowerCase().includes("không xác định") && !speakerName.toLowerCase().includes("chưa xác định")) {
    return speakerName;
  }
  if (speakerId && speakerMap[speakerId] && !isUuid(speakerMap[speakerId])) {
    return speakerMap[speakerId];
  }
  if (speakerLabel) {
    const clean = (speakerLabel.includes(":") ? speakerLabel.split(":").pop() : speakerLabel)?.trim() || "";
    if (clean && clean.toLowerCase() !== "none" && !isUuid(clean)) {
      const match = clean.match(/^(?:speaker[_ -]?|s)?(\d+)$/i);
      if (match) {
        return `Người nói ${match[1]}`;
      }
      return `Người nói ${clean}`;
    }
  }
  return "Người nói 1";
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function LiveMeetingPage({ token }: { token: string }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscript>({});
  const partials = Object.values(liveTranscript).filter(event => event.type === "transcript.partial");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [meetingStatus, setMeetingStatus] = useState<string>("connecting");
  const [socketStatus, setSocketStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [displayMode, setDisplayMode] = useState<"bilingual" | "original" | "translation">("bilingual");
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [hasNewContentWhileScrolled, setHasNewContentWhileScrolled] = useState(false);
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const userScrolledUpRef = useRef(false);
  const speakerMapRef = useRef<Record<string, string>>({});

  // 1. Initial Load of Transcript via Public Endpoint
  useEffect(() => {
    let active = true;
    async function loadInitial() {
      try {
        const data = await sharesApi.transcript(token);
        if (!active) return;
        setMeeting(data.meeting);
        if (data.browser_drafts) setLiveTranscript(current => restoreBrowserDrafts(current, data.browser_drafts!));
        setMeetingStatus(data.meeting.status);

        if (data.speakers && Array.isArray(data.speakers)) {
          const spkMap: Record<string, string> = {};
          for (const s of data.speakers) {
            if (s.id && s.name) spkMap[s.id] = s.name;
          }
          setSpeakerMap(spkMap);
          speakerMapRef.current = spkMap;
        }

        if (data.translations) {
          setTranslations(data.translations);
        }

        if (data.transcript && data.transcript.segments) {
          const currentMap = speakerMapRef.current;
          const initialSegments: LiveSegment[] = data.transcript.segments.map((s: Segment) => ({
            logical_segment_id: s.logical_segment_id,
            speaker_name: resolveSpeakerName(undefined, s.speaker_label, s.speaker_id, currentMap),
            speaker_label: s.speaker_label,
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text,
            translation: data.translations?.[s.logical_segment_id],
          }));
          // The live socket may already have delivered a newer final while the
          // initial HTTP snapshot was loading. Keep those live rows/corrections.
          setSegments(current => [...initialSegments.filter(row => !current.some(live => live.logical_segment_id === row.logical_segment_id)), ...current]
            .sort((a, b) => a.start_ms - b.start_ms));
        }
      } catch (err) {
        if (!active) return;
        setErrorMessage((err as Error).message || "Liên kết chia sẻ không hợp lệ hoặc đã hết hạn.");
        setMeetingStatus("error");
      }
    }
    void loadInitial();

    // Generate QR code for this live URL
    const url = window.location.href;
    setQrDataUrl(`https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(url)}`);

    return () => {
      active = false;
    };
  }, [token]);

  // 2. Realtime WebSocket Connection
  useEffect(() => {
    let stopped = false;

    function connectWs() {
      if (stopped) return;
      const wsUrl = `${config.wsBaseUrl}/realtime/shares/${token}`;
      setSocketStatus("connecting");
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      const pingInterval = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);

      ws.onopen = () => {
        if (stopped) return;
        setSocketStatus("connected");
      };

      ws.onmessage = (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "session.ready") {
            setSocketStatus("connected");
            if (data.status) setMeetingStatus(data.status);
          } else if (data.type === "translations.snapshot") {
            const snap = (data.translations as Record<string, string>) || {};
            setTranslations((curr) => ({ ...curr, ...snap }));
            setSegments((prev) =>
              prev.map((s) => (snap[s.logical_segment_id] ? { ...s, translation: snap[s.logical_segment_id] } : s))
            );
          } else if (data.type === "transcript.interrupted") {
            setLiveTranscript(current => interruptBrowserSession(current, data.stream_session_id));
          } else if (data.type === "transcript.drafts") {
            setLiveTranscript(current => restoreBrowserDrafts(current, data.drafts));
          } else if (data.type === "transcript.partial") {
            setLiveTranscript(current => updateLiveTranscript(current, {
              ...data,
              speaker_name: resolveSpeakerName(data.speaker_name, data.speaker_label, data.speaker_id, speakerMapRef.current),
            }));
            if (userScrolledUpRef.current) {
              setHasNewContentWhileScrolled(true);
            }
          } else if (data.type === "transcript.final") {
            setLiveTranscript(current => updateLiveTranscript(current, data));
            const segId = data.logical_segment_id || `temp-${Date.now()}`;
            const resolvedSpeaker = resolveSpeakerName(
              data.speaker_name,
              data.speaker_label,
              data.speaker_id,
              speakerMapRef.current
            );
            setSegments((prev) => {
              const exists = prev.some((s) => s.logical_segment_id === segId);
              if (exists) {
                return prev.map((s) =>
                  s.logical_segment_id === segId
                    ? {
                        ...s,
                        text: data.text,
                        speaker_name: resolvedSpeaker || s.speaker_name,
                        end_ms: data.end_ms,
                        translation: s.translation || translations[segId],
                      }
                    : s
                );
              }
              return [
                ...prev,
                {
                  logical_segment_id: segId,
                  speaker_name: resolvedSpeaker,
                  speaker_label: data.speaker_label,
                  start_ms: data.start_ms,
                  end_ms: data.end_ms,
                  text: data.text,
                  translation: translations[segId],
                },
              ];
            });
            if (userScrolledUpRef.current) {
              setHasNewContentWhileScrolled(true);
            }
          } else if (data.type === "translation.final") {
            const segId = data.logical_segment_id;
            const text = data.text;
            if (segId && text) {
              setTranslations((curr) => ({ ...curr, [segId]: text }));
              setSegments((prev) =>
                prev.map((s) => (s.logical_segment_id === segId ? { ...s, translation: text } : s))
              );
            }
          } else if (data.type === "transcript.speaker_updated") {
            const segId = data.logical_segment_id;
            const spkId = data.speaker_id;
            if (segId) {
              const newName = resolveSpeakerName(undefined, undefined, spkId, speakerMapRef.current);
              setSegments((prev) =>
                prev.map((s) =>
                  s.logical_segment_id === segId
                    ? { ...s, speaker_name: newName }
                    : s
                )
              );
            }
          } else if (data.type === "speaker.updated") {
            const spkId = data.speaker_id;
            const name = data.name;
            if (spkId && name) {
              speakerMapRef.current = { ...speakerMapRef.current, [spkId]: name };
              setSpeakerMap((curr) => ({ ...curr, [spkId]: name }));
              setSegments((prev) =>
                prev.map((s) =>
                  s.speaker_name === spkId || isUuid(s.speaker_name)
                    ? { ...s, speaker_name: name }
                    : s
                )
              );
            }
          } else if (data.type === "meeting.status") {
            setMeetingStatus(data.status);
            setLiveTranscript(finishLiveTranscript);
          } else if (data.type === "recording.paused") {
            setMeetingStatus("paused");
            setLiveTranscript(finishLiveTranscript);
          } else if (data.type === "recording.resumed") {
            setMeetingStatus("recording");
          }
        } catch {
          // ignore non-json
        }
      };

      ws.onclose = () => {
        clearInterval(pingInterval);
        if (stopped) return;
        setSocketStatus("disconnected");
        setLiveTranscript(finishLiveTranscript);
        reconnectTimeoutRef.current = window.setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

    return () => {
      stopped = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [token]);

  // 3. Auto Scroll Handling
  useEffect(() => {
    if (!autoScroll || userScrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments, liveTranscript, autoScroll]);

  useEffect(() => {
    function onScroll() {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      const isAtBottom = docHeight - scrollY - windowHeight < 120;
      if (isAtBottom) {
        userScrolledUpRef.current = false;
        setAutoScroll(true);
        setHasNewContentWhileScrolled(false);
      } else {
        userScrolledUpRef.current = true;
        setAutoScroll(false);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (isAtBottom) {
      userScrolledUpRef.current = false;
      setAutoScroll(true);
      setHasNewContentWhileScrolled(false);
    } else {
      userScrolledUpRef.current = true;
      setAutoScroll(false);
    }
  }

  function scrollToBottom() {
    userScrolledUpRef.current = false;
    setAutoScroll(true);
    setHasNewContentWhileScrolled(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const isLive = meetingStatus === "recording" || meetingStatus === "processing";
  const isPaused = meetingStatus === "paused";

  const fontMultiplier = fontSize === "sm" ? 0.9 : fontSize === "lg" ? 1.18 : 1.0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0e14",
        color: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Top Navigation Bar */}
      <header
        style={{
          height: 64,
          padding: "0 20px",
          background: "rgba(18, 21, 28, 0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #6366f1, #a855f7)",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              BB
            </div>
            <strong style={{ fontSize: 16, letterSpacing: -0.3 }}>Bóc Băng AI</strong>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: "rgba(255, 255, 255, 0.15)" }} />

          {/* Live Status Badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: "999px",
              background: isLive
                ? "rgba(239, 68, 68, 0.18)"
                : isPaused
                ? "rgba(234, 179, 8, 0.18)"
                : "rgba(148, 163, 184, 0.15)",
              color: isLive ? "#ef4444" : isPaused ? "#eab308" : "#94a3b8",
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${
                isLive
                  ? "rgba(239, 68, 68, 0.35)"
                  : isPaused
                  ? "rgba(234, 179, 8, 0.35)"
                  : "rgba(148, 163, 184, 0.25)"
              }`,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: isLive ? "#ef4444" : isPaused ? "#eab308" : "#94a3b8",
                boxShadow: isLive ? "0 0 8px #ef4444" : "none",
                animation: isLive ? "pulse 1.6s infinite" : "none",
              }}
            />
            <span>{isLive ? "TRỰC TIẾP" : isPaused ? "TẠM DỪNG" : "ĐÃ KẾT THÚC"}</span>
          </div>

          {socketStatus !== "connected" && (
            <span style={{ fontSize: 11, color: "#f59e0b" }}>
              {socketStatus === "connecting" ? "Đang kết nối lại…" : "Mất kết nối"}
            </span>
          )}
        </div>

        {/* Toolbar Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Display Mode Toggle */}
          <div
            style={{
              display: "flex",
              background: "rgba(255, 255, 255, 0.06)",
              borderRadius: 8,
              padding: 2,
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <button
              type="button"
              onClick={() => setDisplayMode("bilingual")}
              style={{
                background: displayMode === "bilingual" ? "#4f46e5" : "transparent",
                color: displayMode === "bilingual" ? "#ffffff" : "#94a3b8",
                border: 0,
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Song ngữ
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("original")}
              style={{
                background: displayMode === "original" ? "#4f46e5" : "transparent",
                color: displayMode === "original" ? "#ffffff" : "#94a3b8",
                border: 0,
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Gốc
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("translation")}
              style={{
                background: displayMode === "translation" ? "#4f46e5" : "transparent",
                color: displayMode === "translation" ? "#ffffff" : "#94a3b8",
                border: 0,
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Bản dịch
            </button>
          </div>

          {/* Font Size Adjuster */}
          <div
            style={{
              display: "flex",
              background: "rgba(255, 255, 255, 0.06)",
              borderRadius: 8,
              padding: 2,
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <button
              type="button"
              onClick={() => setFontSize("sm")}
              title="Cỡ chữ nhỏ"
              style={{
                background: fontSize === "sm" ? "#334155" : "transparent",
                color: "#e2e8f0",
                border: 0,
                borderRadius: 6,
                padding: "4px 7px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setFontSize("base")}
              title="Cỡ chữ vừa"
              style={{
                background: fontSize === "base" ? "#334155" : "transparent",
                color: "#e2e8f0",
                border: 0,
                borderRadius: 6,
                padding: "4px 7px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              A
            </button>
            <button
              type="button"
              onClick={() => setFontSize("lg")}
              title="Cỡ chữ lớn"
              style={{
                background: fontSize === "lg" ? "#334155" : "transparent",
                color: "#e2e8f0",
                border: 0,
                borderRadius: 6,
                padding: "4px 7px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              A+
            </button>
          </div>

          {/* QR Code Button */}
          {qrDataUrl && (
            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              title="Xem mã QR để chia sẻ"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 8,
                padding: "6px 10px",
                color: "#f8fafc",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
              }}
            >
              <span>📱 Mã QR</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxWidth: 960,
          width: "100%",
          margin: "0 auto",
          padding: "20px 16px 40px 16px",
          boxSizing: "border-box",
        }}
      >
        {/* Meeting Hero Banner */}
        <div
          style={{
            padding: "16px 20px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: 14,
            marginBottom: 20,
          }}
        >
          <h1 style={{ margin: "0 0 6px 0", fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>
            {meeting?.title || "Cuộc họp trực tiếp"}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, fontSize: 12, color: "#94a3b8" }}>
            <span>📅 {new Date().toLocaleDateString("vi-VN")}</span>
            <span>🎙 Nhận diện & dịch đa ngôn ngữ tự động</span>
            {isLive && (
              <span style={{ color: "#4ade80", fontWeight: 500 }}>
                ● Đang truyền phát trực tiếp văn bản theo thời gian thực
              </span>
            )}
          </div>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div
            style={{
              padding: "16px",
              borderRadius: 10,
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#fca5a5",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Transcript Feed Scrollable Area */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            paddingRight: 6,
          }}
        >
          {segments.length === 0 && partials.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "60px 20px",
                color: "#64748b",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>🎙️</div>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 16, color: "#cbd5e1" }}>
                {isLive ? "Đang lắng nghe cuộc họp…" : "Chưa có nội dung văn bản"}
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                {isLive
                  ? "Khi có người nói, nội dung văn bản và bản dịch sẽ lập tức xuất hiện tại đây theo thời gian thực."
                  : "Cuộc họp chưa có dữ liệu bóc băng."}
              </p>
            </div>
          )}

          {/* Finalized Segments */}
          {segments.map((seg, idx) => {
            const hasTranslation = Boolean(seg.translation || translations[seg.logical_segment_id]);
            const translationText = seg.translation || translations[seg.logical_segment_id];

            return (
              <div
                key={seg.logical_segment_id || idx}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  transition: "background 0.2s ease",
                }}
              >
                {/* Speaker Avatar Pill */}
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                    color: "white",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {meeting?.stt_mode === "browser" ? "T" : (seg.speaker_name || "N").slice(0, 1).toUpperCase()}
                </div>

                {/* Content Box */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 650, color: "#e2e8f0" }}>
                      {meeting?.stt_mode === "browser" ? "Văn bản" : seg.speaker_name || "Người nói"}
                    </span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {formatMs(seg.start_ms)}
                    </span>
                  </div>

                  {/* Original Text */}
                  {(displayMode === "bilingual" || displayMode === "original" || !hasTranslation) && (
                    <div
                      style={{
                        fontSize: 14 * fontMultiplier,
                        lineHeight: 1.6,
                        color: "#f1f5f9",
                        wordBreak: "break-word",
                      }}
                    >
                      {seg.text}
                    </div>
                  )}

                  {/* Translation Text */}
                  {hasTranslation && (displayMode === "bilingual" || displayMode === "translation") && (
                    <div
                      style={{
                        marginTop: displayMode === "bilingual" ? 6 : 0,
                        fontSize: 13.5 * fontMultiplier,
                        lineHeight: 1.55,
                        color: "#38bdf8",
                        wordBreak: "break-word",
                        padding: displayMode === "bilingual" ? "4px 8px" : "0",
                        background: displayMode === "bilingual" ? "rgba(56, 189, 248, 0.08)" : "transparent",
                        borderRadius: 6,
                        borderLeft: displayMode === "bilingual" ? "2px solid #38bdf8" : "none",
                      }}
                    >
                      {translationText}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Active Live Partial Speech (Đang nói thời gian thực) */}
          {partials.map(partial => (
            <div
              key={partial.stream_segment_id ?? partial.start_ms}
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(99, 102, 241, 0.08)",
                border: "1px dashed rgba(129, 140, 248, 0.4)",
                animation: partial.recognition_status === "unconfirmed" ? undefined : "pulseBorder 1.5s infinite",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "#4f46e5",
                  color: "white",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                🎙️
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 650, color: "#a5b4fc" }}>
                    {meeting?.stt_mode === "browser" ? "Văn bản" : partial.speaker_name || "Đang nói…"}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#818cf8",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#818cf8",
                        animation: partial.recognition_status === "unconfirmed" ? undefined : "pulse 1s infinite",
                      }}
                    />
                    {partial.revision !== undefined || partial.recognition_status === "unconfirmed" ? browserDraftLabel(partial) : "Thời gian thực"}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 14 * fontMultiplier,
                    lineHeight: 1.6,
                    color: "#f8fafc",
                    fontStyle: "italic",
                    wordBreak: "break-word",
                  }}
                >
                  {partial.revision !== undefined ? <BrowserTranscriptText text={partial.text} active={partial.recognition_status !== "unconfirmed"} /> : partial.text}
                  {partial.revision === undefined && partial.recognition_status !== "unconfirmed" && <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 14,
                      background: "#818cf8",
                      marginLeft: 4,
                      verticalAlign: "middle",
                      animation: "blink 0.8s infinite",
                    }}
                  />}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} style={{ height: 1 }} />
        </div>

        {/* Floating Jump-to-bottom Button */}
        {hasNewContentWhileScrolled && (
          <button
            type="button"
            onClick={scrollToBottom}
            style={{
              position: "fixed",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#4f46e5",
              color: "#ffffff",
              border: 0,
              borderRadius: "999px",
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 8px 24px rgba(79, 70, 229, 0.4)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              zIndex: 40,
              animation: "bounce 1s infinite",
            }}
          >
            <span>⬇ Xem nội dung mới nhất</span>
          </button>
        )}
      </div>

      {/* QR Code Popover Modal */}
      {showQrModal && qrDataUrl && (
        <div
          className="dialog-backdrop"
          onClick={() => setShowQrModal(false)}
          style={{ zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#181b24",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 16,
              padding: 24,
              width: "min(90vw, 360px)",
              textAlign: "center",
              color: "#f8fafc",
              boxShadow: "0 24px 48px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <strong style={{ fontSize: 16 }}>Quét mã QR để xem trực tiếp</strong>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                style={{ background: "transparent", border: 0, color: "#94a3b8", cursor: "pointer", fontSize: 18 }}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                background: "white",
                padding: 12,
                borderRadius: 12,
                display: "inline-block",
                marginBottom: 12,
              }}
            >
              <img src={qrDataUrl} alt="Mã QR" style={{ width: 220, height: 220, display: "block" }} />
            </div>
            <p style={{ margin: "0 0 16px 0", fontSize: 12, color: "#94a3b8" }}>
              Bất kỳ ai quét mã này đều có thể theo dõi trực tiếp cuộc họp trên điện thoại.
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(window.location.href);
                alert("Đã sao chép liên kết!");
              }}
              style={{
                width: "100%",
                background: "#4f46e5",
                color: "white",
                border: 0,
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sao chép liên kết
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
