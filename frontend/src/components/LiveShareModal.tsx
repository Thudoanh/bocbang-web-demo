async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

import { useEffect, useState } from "react";
import { meetingsApi } from "../api/endpoints";

export function LiveShareModal({
  meetingId,
  meetingTitle,
  isRecording,
  close,
}: {
  meetingId: string;
  meetingTitle: string;
  isRecording?: boolean;
  close: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareToken, setShareToken] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  const liveUrl = shareToken
    ? `${window.location.origin}/live/${shareToken}`
    : "";

  useEffect(() => {
    let active = true;
    async function init() {
      setLoading(true);
      setError("");
      try {
        const res = await meetingsApi.getOrCreateLiveShare(meetingId);
        if (!active) return;
        setShareToken(res.token);
        const url = `${window.location.origin}/live/${res.token}`;
        const qr = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(url)}`;
        if (!active) return;
        setQrDataUrl(qr);
      } catch (err) {
        if (!active) return;
        setError((err as Error).message || "Không thể tạo liên kết chia sẻ.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [meetingId]);

  function handleCopy() {
    if (!liveUrl) return;
    void copyToClipboard(liveUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  function openShare(type: string) {
    if (!liveUrl) return;
    const encodedUrl = encodeURIComponent(liveUrl);
    const encodedTitle = encodeURIComponent(`Xem trực tiếp cuộc họp: ${meetingTitle}`);
    let url = "";
    if (type === "facebook") url = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    else if (type === "messenger") url = `https://www.facebook.com/dialog/send?link=${encodedUrl}&app_id=1091931238593&redirect_uri=${encodedUrl}`;
    else if (type === "telegram") url = `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`;
    else if (type === "whatsapp") url = `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`;
    else if (type === "email") url = `mailto:?subject=${encodedTitle}&body=${encodedUrl}`;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="dialog-backdrop" onClick={close} style={{ zIndex: 1000 }}>
      <div
        className="live-share-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#181b24",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "16px",
          width: "min(92vw, 480px)",
          color: "#f8fafc",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.55)",
          padding: "24px",
          position: "relative",
          animation: "modalFadeIn 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "10px",
                background: "rgba(99, 102, 241, 0.18)",
                color: "#818cf8",
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 650 }}>Chia sẻ cuộc họp trực tiếp</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isRecording ? "#22c55e" : "#94a3b8",
                    boxShadow: isRecording ? "0 0 8px #22c55e" : "none",
                  }}
                />
                <span style={{ fontSize: 12, color: isRecording ? "#4ade80" : "#94a3b8" }}>
                  {isRecording ? "Đang phát trực tiếp" : "Xem nội dung cuộc họp"}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            style={{
              background: "transparent",
              border: 0,
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 20,
              padding: "4px 8px",
              borderRadius: "6px",
            }}
            title="Đóng"
          >
            ✕
          </button>
        </div>

        <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>
          Người xem có thể theo dõi trực tiếp văn bản ghi âm và bản dịch theo thời gian thực mà <strong>không cần đăng nhập</strong>.
        </p>

        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>
            <div style={{ marginBottom: 12 }}>Đang khởi tạo mã chia sẻ & mã QR…</div>
          </div>
        ) : error ? (
          <div style={{ padding: "16px", borderRadius: 8, background: "rgba(239, 68, 68, 0.15)", color: "#f87171", fontSize: 13 }}>
            {error}
          </div>
        ) : (
          <>
            {/* QR Code Container */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px",
                background: "rgba(255, 255, 255, 0.04)",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.06)",
                marginBottom: 16,
              }}
            >
              {qrDataUrl && (
                <div
                  style={{
                    background: "#ffffff",
                    padding: "10px",
                    borderRadius: "10px",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
                    marginBottom: 10,
                  }}
                >
                  <img
                    src={qrDataUrl}
                    alt="Mã QR xem trực tiếp"
                    style={{ width: 180, height: 180, display: "block" }}
                  />
                </div>
              )}
              <span style={{ fontSize: 12, color: "#cbd5e1" }}>
                📱 Quét mã QR bằng điện thoại để xem trực tiếp
              </span>
            </div>

            {/* Link Box */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
                Hoặc chia sẻ qua liên kết trực tiếp:
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(0, 0, 0, 0.35)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  padding: "4px 6px 4px 12px",
                }}
              >
                <input
                  type="text"
                  readOnly
                  value={liveUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: 0,
                    outline: "none",
                    color: "#f1f5f9",
                    fontSize: 13,
                    fontFamily: "monospace",
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  style={{
                    background: copied ? "#22c55e" : "#6366f1",
                    color: "#ffffff",
                    border: 0,
                    borderRadius: "6px",
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copied ? "✓ Đã sao chép" : "Sao chép"}
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => window.open(liveUrl, "_blank")}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#f8fafc",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <span>Mở trang người xem</span>
                <span style={{ fontSize: 14 }}>↗</span>
              </button>
            </div>

            {/* Social Share Icons */}
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <button
                type="button"
                onClick={() => openShare("facebook")}
                title="Chia sẻ lên Facebook"
                style={{ width: 34, height: 34, borderRadius: "50%", background: "#1877f2", border: 0, color: "white", cursor: "pointer", fontSize: 14, fontWeight: "bold" }}
              >
                f
              </button>
              <button
                type="button"
                onClick={() => openShare("messenger")}
                title="Gửi qua Messenger"
                style={{ width: 34, height: 34, borderRadius: "50%", background: "#0084ff", border: 0, color: "white", cursor: "pointer", fontSize: 14 }}
              >
                💬
              </button>
              <button
                type="button"
                onClick={() => openShare("telegram")}
                title="Chia sẻ lên Telegram"
                style={{ width: 34, height: 34, borderRadius: "50%", background: "#229ed9", border: 0, color: "white", cursor: "pointer", fontSize: 14 }}
              >
                ✈
              </button>
              <button
                type="button"
                onClick={() => openShare("whatsapp")}
                title="Chia sẻ qua WhatsApp"
                style={{ width: 34, height: 34, borderRadius: "50%", background: "#25d366", border: 0, color: "white", cursor: "pointer", fontSize: 14 }}
              >
                📞
              </button>
              <button
                type="button"
                onClick={() => openShare("email")}
                title="Gửi email"
                style={{ width: 34, height: 34, borderRadius: "50%", background: "#475569", border: 0, color: "white", cursor: "pointer", fontSize: 14 }}
              >
                ✉
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
