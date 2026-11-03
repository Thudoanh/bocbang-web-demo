import { useState, useRef, useEffect } from "react";
import { meetingsApi } from "../api/endpoints";
import type { Meeting } from "../types/domain";
import { Icon, Status } from "../components/ui";
import { navigate } from "../app/router";

export function MeetingsPage({
  createOnly = false,
  initialSource,
}: {
  createOnly?: boolean;
  initialSource?: "realtime" | "upload";
}) {
  const isUpload = initialSource === "upload" || new URLSearchParams(window.location.search).get("mode") === "upload";

  if (isUpload) {
    return <UploadScreen />;
  }

  return <StartScreen />;
}

/* ═══════════════════════════════════════════
   START SCREEN - TẠO PHIÊN HỌP MỚI (ẢNH 2)
═══════════════════════════════════════════ */
function StartScreen() {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [languageMode, setLanguageMode] = useState<"auto" | "vi" | "en">("auto");

  async function handleCreate(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const meeting = await meetingsApi.create({
        title: title.trim(),
        source_type: "realtime",
        language_mode: languageMode,
        diarization_enabled: true,
      });
      window.dispatchEvent(new CustomEvent("bocbang:refresh-meetings"));
      navigate(`/meetings/${meeting.id}`);
    } catch (cause) {
      alert((cause as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="start-screen-container">
      <h1 className="start-screen-title">Tạo phiên họp mới</h1>
      <p className="start-screen-subtitle">
        Nhập tên phiên họp để bắt đầu ghi âm và phân tích cuộc họp
      </p>

      <form className="start-screen-input-pill" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Ví dụ: Họp team hàng tuần, Thảo luận dự án..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          disabled={creating}
        />
        <button
          type="submit"
          className="start-screen-submit-btn"
          disabled={!title.trim() || creating}
          aria-label="Bắt đầu phiên họp"
        >
          <Icon name="arrow-up" />
        </button>
      </form>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 }}>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>Ngôn ngữ:</span>
        <div style={{ display: "inline-flex", background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 3, border: "1px solid rgba(255,255,255,0.1)" }}>
          <button
            type="button"
            onClick={() => setLanguageMode("auto")}
            style={{
              background: languageMode === "auto" ? "#6366f1" : "transparent",
              color: languageMode === "auto" ? "#ffffff" : "#94a3b8",
              border: 0,
              borderRadius: 8,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            🌐 Tự động
          </button>
          <button
            type="button"
            onClick={() => setLanguageMode("vi")}
            style={{
              background: languageMode === "vi" ? "#6366f1" : "transparent",
              color: languageMode === "vi" ? "#ffffff" : "#94a3b8",
              border: 0,
              borderRadius: 8,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            🇻🇳 Tiếng Việt
          </button>
          <button
            type="button"
            onClick={() => setLanguageMode("en")}
            style={{
              background: languageMode === "en" ? "#6366f1" : "transparent",
              color: languageMode === "en" ? "#ffffff" : "#94a3b8",
              border: 0,
              borderRadius: 8,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            🇬🇧 Tiếng Anh
          </button>
        </div>
      </div>

      <div className="start-screen-hint" style={{ marginTop: 10 }}>
        Nhấn Enter để tạo phiên họp và bắt đầu
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   UPLOAD SCREEN - TẢI LÊN BẢN GHI SẴN CÓ (ẢNH 3)
═══════════════════════════════════════════ */
function UploadScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadLang, setUploadLang] = useState<"auto" | "vi" | "en">("auto");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [recentUploads, setRecentUploads] = useState<Meeting[]>([]);

  useEffect(() => {
    meetingsApi.list({ source_type: "upload", limit: 10 }).then(setRecentUploads).catch(() => {});
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const meetingTitle = file.name.replace(/\.[^/.]+$/, "");
    setUploading(true);
    setUploadError("");
    setUploadProgress("Đang khởi tạo phiên họp…");
    try {
      const meeting = await meetingsApi.create({
        title: meetingTitle,
        source_type: "upload",
        language_mode: uploadLang,
        diarization_enabled: true,
      });
      setUploadProgress("Đang truyền tệp (0%)…");
      await meetingsApi.uploadMedia(meeting.id, file, (percent) => {
        setUploadProgress(`Đang tải lên máy chủ: ${percent}%…`);
      });
      setUploadProgress("Tải lên hoàn tất 100%! Đang mở giao diện cuộc họp…");
      window.dispatchEvent(new CustomEvent("bocbang:refresh-meetings"));
      navigate(`/meetings/${meeting.id}`);
    } catch (e) {
      setUploading(false);
      setUploadProgress("");
      const msg = (e as Error).message || "Không thể kết nối máy chủ khi tải tệp. Vui lòng kiểm tra lại.";
      setUploadError(msg);
    }
  }

  return (
    <div className="upload-screen-container">
      <h2 className="upload-screen-heading">Trạng thái bản ghi cuộc họp</h2>

      {uploadError && (
        <div style={{
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          color: "#ef4444",
          borderRadius: 12,
          padding: "12px 18px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 13.5,
          fontWeight: 500,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>⚠️</span>
            <span>{uploadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setUploadError("")}
            style={{ background: "transparent", border: 0, color: "#ef4444", cursor: "pointer", fontSize: 16 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Ngôn ngữ âm thanh:</span>
        <select
          value={uploadLang}
          onChange={(e) => setUploadLang(e.target.value as "auto" | "vi" | "en")}
          style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
        >
          <option value="auto">Tự động nhận diện (VI / EN)</option>
          <option value="vi">Tiếng Việt</option>
          <option value="en">Tiếng Anh (English)</option>
        </select>
      </div>

      <div
        className="upload-dropzone-blue"
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.webm,.mp4,.mov,.mkv,.avi,.mpeg,.mpg"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="upload-dropzone-icon">
          <Icon name="upload" />
        </div>
        <div className="upload-dropzone-title">
          {uploading ? uploadProgress : "Tải lên file ghi âm có sẵn"}
        </div>
        <div className="upload-dropzone-detail">
          Hỗ trợ MP3, WAV, M4A, AAC, FLAC, OGG, MP4, MOV, MKV... Kích thước tối đa 500MB.
        </div>
      </div>

      <p className="upload-screen-notice">
        File audio/video luôn dùng STT Cloud. Lựa chọn Browser chỉ áp dụng cho microphone. {" "}
        Lưu ý: Thời gian xử lý phụ thuộc vào độ dài của tệp. Hệ thống sẽ tự động bóc băng, nhận diện người nói và tạo bản dịch ngay khi hoàn tất.
      </p>

      <div className="upload-recent-section">
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text)" }}>
          Tải lên gần đây
        </h3>
        {recentUploads.length === 0 ? (
          <div className="upload-recent-empty">Không có bản ghi</div>
        ) : (
          <div className="meeting-list">
            {recentUploads.map((m) => (
              <article key={m.id} className="meeting-row manageable-meeting-row">
                <a className="meeting-row-link" href={`/meetings/${m.id}`} />
                <div className="avatar">{(m.title || "AU").slice(0, 2).toUpperCase()}</div>
                <div className="meeting-row-main">
                  <strong>{m.title}</strong>
                  <p>
                    {new Intl.DateTimeFormat("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    }).format(new Date(m.created_at))}
                  </p>
                </div>
                <Status value={m.status} />
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
