import type { Meeting, TranscriptPolish } from "../types/domain";

export type PolishContext = { meeting: Meeting; hasTranscript?: boolean; versionId?: string; available: boolean };
export function isPolishPending(proposal?: TranscriptPolish | null) {
  return Boolean(proposal && !["completed", "failed"].includes(proposal.job.status));
}
export function isPolishStale(proposal: TranscriptPolish | null | undefined, versionId?: string) {
  return Boolean(proposal && versionId && versionId !== (proposal.accepted_version_id ?? proposal.source_version_id));
}
export function polishToolState(context?: PolishContext, proposal?: TranscriptPolish | null, error?: string) {
  if (!context) return { disabled: !error, label: error ? "Lỗi tải" : "Đang kiểm tra", reason: error || "Đang kiểm tra trạng thái cuộc họp.", tone: error ? "error" : "idle" };
  if (context.meeting.status !== "completed") return { disabled: true, label: "Chưa kết thúc", reason: "Kết thúc cuộc họp trước khi làm mịn transcript.", tone: "idle" };
  if (context.hasTranscript === false) return { disabled: true, label: "Chưa có nội dung", reason: "Chưa có transcript để làm mịn.", tone: "idle" };
  if (error) return { disabled: false, label: "Lỗi tải", reason: error, tone: "error" };
  if (isPolishPending(proposal)) return { disabled: false, label: "Đang xử lý", reason: "AI đang làm mịn transcript; bản gốc chưa thay đổi.", tone: "pending" };
  if (proposal?.job.status === "failed") return { disabled: false, label: "Có lỗi", reason: "Không thể làm mịn. Mở để xem lỗi và thử lại.", tone: "error" };
  if (isPolishStale(proposal, context.versionId)) return { disabled: false, label: "Cần làm lại", reason: "Transcript đã thay đổi sau lần làm mịn này.", tone: "warning" };
  if (proposal?.accepted_version_id) return { disabled: false, label: "Đã chốt", reason: "Bản làm mịn đã được người dùng chốt.", tone: "accepted" };
  if (proposal?.job.status === "completed") return { disabled: false, label: "Chờ duyệt", reason: "AI đã làm mịn. Mở để đối chiếu, chỉnh sửa và chốt.", tone: "review" };
  if (!context.available) return { disabled: true, label: "AI chưa bật", reason: "Chưa cấu hình AI làm mịn transcript.", tone: "idle" };
  if (!["owner", "edit"].includes(context.meeting.permission)) return { disabled: true, label: "Chỉ được xem", reason: "Chưa có bản làm mịn; bạn không có quyền tạo yêu cầu.", tone: "idle" };
  return { disabled: false, label: "Sẵn sàng", reason: "Mở công cụ làm mịn transcript.", tone: "idle" };
}
