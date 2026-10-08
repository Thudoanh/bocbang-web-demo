import { useState, useRef, useEffect } from "react";
import { Button, Icon } from "./ui";
import { voiceProfilesApi } from "../api/endpoints";
import type { VoiceProfile } from "../types/domain";

interface VoiceEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrolled: (profile: VoiceProfile) => void;
  meetingId?: string;
  defaultName?: string;
}

export function VoiceEnrollmentModal({
  isOpen,
  onClose,
  onEnrolled,
  meetingId,
  defaultName = "",
}: VoiceEnrollmentModalProps) {
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [name, setName] = useState(defaultName);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (defaultName) setName(defaultName);
  }, [defaultName]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  if (!isOpen) return null;

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 25) {
            stopRecording();
            return 25;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setError("Không thể truy cập microphone. Vui lòng cấp quyền cho trình duyệt.");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioBlob(file);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
  };

  const handleSave = async () => {
    if (!audioBlob) {
      setError("Vui lòng ghi âm hoặc tải lên một mẫu giọng nói.");
      return;
    }
    if (meetingId && !name.trim()) {
      setError("Vui lòng nhập họ và tên của người phát biểu.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let profile: VoiceProfile;
      if (meetingId) {
        profile = await voiceProfilesApi.enrollMeetingGuest(meetingId, name.trim(), audioBlob);
      } else {
        profile = await voiceProfilesApi.enrollMyProfile(audioBlob);
      }
      onEnrolled(profile);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể lưu mẫu giọng nói.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "540px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0, color: "#111827" }}>
              {meetingId ? "Đăng ký Mẫu Giọng Người Phát Biểu" : "Mẫu Giọng Nói Cá Nhân Của Tôi"}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#6b7280" }}>
              Hệ thống sẽ dùng mẫu giọng này để tự động nhận diện và gán tên trong cuộc họp.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#9ca3af",
              padding: "4px",
            }}
          >
            <Icon name="close" />
          </button>
        </div>

        <div style={{ padding: "24px" }}>
          {meetingId && (
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: "500",
                  color: "#374151",
                  marginBottom: "6px",
                }}
              >
                Họ và tên người phát biểu <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Nguyễn Văn A"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Mode Switcher */}
          <div
            style={{
              display: "flex",
              backgroundColor: "#f3f4f6",
              borderRadius: "8px",
              padding: "4px",
              marginBottom: "20px",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMode("record");
                setAudioBlob(null);
                setAudioUrl(null);
              }}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "6px",
                border: "none",
                fontWeight: "500",
                fontSize: "13px",
                cursor: "pointer",
                backgroundColor: mode === "record" ? "#ffffff" : "transparent",
                color: mode === "record" ? "#111827" : "#6b7280",
                boxShadow: mode === "record" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Ghi âm trực tiếp (Microphone)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("upload");
                setAudioBlob(null);
                setAudioUrl(null);
              }}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "6px",
                border: "none",
                fontWeight: "500",
                fontSize: "13px",
                cursor: "pointer",
                backgroundColor: mode === "upload" ? "#ffffff" : "transparent",
                color: mode === "upload" ? "#111827" : "#6b7280",
                boxShadow: mode === "upload" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Tải file âm thanh có sẵn
            </button>
          </div>

          {/* Mode: Record */}
          {mode === "record" && (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div
                style={{
                  backgroundColor: "#f9fafb",
                  border: "1px dashed #d1d5db",
                  borderRadius: "8px",
                  padding: "16px",
                  marginBottom: "20px",
                  textAlign: "left",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#4b5563", marginBottom: "4px" }}>
                  Đoạn thoại mẫu gợi ý (đọc to, rõ ràng từ 10 - 20 giây):
                </div>
                <div style={{ fontSize: "13px", color: "#1f2937", lineHeight: "1.6", fontStyle: "italic" }}>
                  "Xin chào, tôi là {name || "[Tên của bạn]"}. Tôi tham gia cuộc họp để trao đổi thông tin, thảo luận các vấn đề quan trọng và đưa ra ý kiến đóng góp cho dự án."
                </div>
              </div>

              {!isRecording && !audioUrl && (
                <div>
                  <Button
                    tone="dark"
                    onClick={startRecording}
                    style={{ padding: "12px 24px", fontSize: "14px", fontWeight: "600" }}
                  >
                    Bắt đầu ghi âm mẫu giọng
                  </Button>
                  <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>
                    Khuyến nghị thu âm trong không gian yên tĩnh.
                  </p>
                </div>
              )}

              {isRecording && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "16px" }}>
                    <span
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        backgroundColor: "#ef4444",
                        display: "inline-block",
                        animation: "pulse 1.5s infinite",
                      }}
                    />
                    <span style={{ fontSize: "18px", fontWeight: "700", color: "#ef4444" }}>
                      0:{recordingSeconds < 10 ? `0${recordingSeconds}` : recordingSeconds} / 0:25s
                    </span>
                  </div>
                  <Button
                    tone="danger"
                    onClick={stopRecording}
                    style={{ padding: "10px 20px", fontSize: "14px" }}
                  >
                    Dừng ghi âm
                  </Button>
                </div>
              )}

              {audioUrl && !isRecording && (
                <div>
                  <div style={{ marginBottom: "16px" }}>
                    <audio src={audioUrl} controls style={{ width: "100%", height: "40px" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                    <Button
                      tone="light"
                      onClick={() => {
                        setAudioBlob(null);
                        setAudioUrl(null);
                      }}
                      disabled={isSubmitting}
                    >
                      Ghi âm lại
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mode: Upload */}
          {mode === "upload" && (
            <div style={{ padding: "12px 0", textAlign: "center" }}>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                style={{ display: "none" }}
                id="voice-file-input"
                disabled={isSubmitting}
              />
              <label
                htmlFor="voice-file-input"
                style={{
                  display: "block",
                  padding: "32px 16px",
                  border: "2px dashed #d1d5db",
                  borderRadius: "8px",
                  backgroundColor: "#f9fafb",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: "500", color: "#374151" }}>
                  Bấm để chọn file âm thanh mẫu (WAV, MP3, M4A...)
                </div>
                <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
                  Độ dài khuyến nghị từ 5 đến 30 giây
                </div>
              </label>

              {audioUrl && (
                <div style={{ marginTop: "16px" }}>
                  <audio src={audioUrl} controls style={{ width: "100%", height: "40px" }} />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: "16px",
                padding: "10px 12px",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                color: "#b91c1c",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "16px 24px",
            backgroundColor: "#f9fafb",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
          }}
        >
          <Button tone="light" onClick={onClose} disabled={isSubmitting}>
            Hủy bỏ
          </Button>
          <Button
            tone="dark"
            onClick={handleSave}
            disabled={!audioBlob || isSubmitting || isRecording}
          >
            {isSubmitting ? "Đang xử lý..." : "Lưu mẫu giọng"}
          </Button>
        </div>
      </div>
    </div>
  );
}
