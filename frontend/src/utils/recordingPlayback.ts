import type { MeetingRecording } from "../types/domain";

export function recordingLabel(value?: MeetingRecording) {
  if (!value) return "Nghe lại — Đang kiểm tra băng ghi âm";
  switch (value.status) {
    case "ready": return "Nghe lại băng ghi âm";
    case "pending": return "Nghe lại — Đang chuẩn bị băng ghi âm";
    case "failed": return "Nghe lại — Chuẩn bị băng thất bại";
    case "deleted": return "Băng ghi âm đã được xóa";
    case "not_completed": return "Nghe lại sau khi kết thúc cuộc họp";
    case "unavailable": return value.can_prepare ? "Chuẩn bị băng ghi âm từ âm thanh đã lưu" : "Không có âm thanh gốc để nghe lại";
  }
}

export function recordingPollDelay(value?: MeetingRecording, error = false) {
  if (error) return 5000;
  if (value?.status === "pending") return 2000;
  if (value?.status === "not_completed") return 10000;
  return undefined;
}
