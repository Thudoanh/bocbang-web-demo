import type { Speaker } from "../types/domain";
import type { TranscriptPolishReviewState } from "../state/useTranscriptPolish";
import { formatTimestampInput } from "../utils/time";
import { Button, Loading, Status } from "./ui";

export function TranscriptPolishReview({ review, speakers }: { review: TranscriptPolishReviewState; speakers: Speaker[] }) {
  const { proposal, draft, setDraft, editing, setEditing, original, setOriginal, busy, error, notice, pending, accepted, stale, dirty, editable, generate, save } = review;
  const available = Boolean(review.context?.available);
  return <section className="polish-review" aria-labelledby="polish-title">
    <div className="polish-heading"><h2 id="polish-title">{accepted ? "Transcript đã chốt" : "Duyệt transcript làm mịn"}</h2>{proposal && (proposal.job.status === "completed" && !accepted ? <span className="status">Đã làm mịn · Chờ duyệt</span> : <Status value={proposal.job.status} />)}</div>
    <p>AI đề xuất sửa lỗi chép lời và dấu câu, không tóm tắt. Hãy kiểm tra kỹ tên riêng, con số và ý nghĩa trước khi chốt. Bản gốc luôn được giữ trong lịch sử; bản đang sử dụng chỉ thay đổi khi bạn chốt.</p>
    {error && <div className="notice" role="alert">{error}</div>}
    {dirty && <div className="notice" role="status">Có sửa đổi chưa lưu. Lưu bản nháp hoặc chốt để giữ thay đổi. <Button disabled={busy} onClick={review.discard}>Bỏ sửa chưa lưu</Button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {error && <Button onClick={review.retry} disabled={busy || dirty}>Tải lại bản nháp</Button>}
    {proposal === undefined && !error && <Loading label="Đang đọc trạng thái làm mịn…" />}
    {pending && proposal && <Loading label={proposal.job.status === "retrying" ? "AI đang thử lại. Bạn có thể rời trang và quay lại sau." : "Đang làm mịn transcript… Bản gốc đã được lưu an toàn."} />}
    {proposal?.job.status === "failed" && <p role="alert">{proposal.job.error?.message ?? "Không thể làm mịn transcript."} Bạn có thể thử lại hoặc đóng hộp và sửa transcript trong Bản ghi bằng tay.</p>}
    {stale && <p className="notice">Transcript nguồn đã thay đổi. Cần tạo đề xuất mới trước khi chốt để không ghi đè thay đổi khác.</p>}
    {proposal?.job.status === "completed" && <>
      <div className="polish-actions">
        <Button onClick={() => setOriginal((value) => !value)}>{original ? "Ẩn bản gốc" : "Đối chiếu bản gốc"}</Button>
        {editable && !accepted && !stale && <>
          <Button disabled={busy} onClick={() => setEditing((value) => !value)}>{editing ? "Xem bản nháp" : "Sửa transcript"}</Button>
          {editing && <Button disabled={busy} onClick={() => void save(false)}>Lưu bản nháp</Button>}
          <Button tone="dark" disabled={busy || review.tool.disabled || Boolean(review.queryError) || proposal.segments.some((row) => !(draft[row.logical_segment_id] ?? row.text).trim())} onClick={() => void save(true)}>{busy ? "Đang lưu…" : "Chốt transcript"}</Button>
        </>}
      </div>
      <div className="polish-segments">
        {proposal.segments.map((row, index) => <article className="polish-segment" key={row.logical_segment_id}>
          <strong>{formatTimestampInput(row.start_ms)} – {formatTimestampInput(row.end_ms)} · {speakers.find((speaker) => speaker.id === row.speaker_id)?.name ?? "Chưa xác định người nói"}</strong>
          {original && <div className="polish-original"><small>Bản gốc</small><p>{row.original_text}</p></div>}
          <label><span>{editing && !accepted && !stale ? "Nội dung có thể sửa" : "Bản đã làm mịn"} · Đoạn {index + 1}</span>
            {editing && !accepted && !stale ? <textarea rows={3} maxLength={50000} disabled={busy} value={draft[row.logical_segment_id] ?? row.text} onChange={(event) => setDraft((current) => ({ ...current, [row.logical_segment_id]: event.target.value }))} /> : <p>{draft[row.logical_segment_id] ?? row.text}</p>}
          </label>
        </article>)}
      </div>
    </>}
    {editable && !pending && (!proposal || proposal.job.status === "failed" || stale) && <Button disabled={busy || !available || dirty || review.tool.disabled} onClick={() => void generate()}>{busy ? "Đang tạo yêu cầu…" : "Làm mịn transcript bằng AI"}</Button>}
    {!available && <p>Chưa cấu hình AI làm mịn. Bạn vẫn có thể đóng hộp và sửa transcript thủ công trong Bản ghi.</p>}
  </section>;
}
