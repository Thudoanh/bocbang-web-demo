import type { Speaker } from "../types/domain";
import type { TranscriptPolishReviewState } from "../state/useTranscriptPolish";
import { formatTimestampInput } from "../utils/time";
import { Loading, Status } from "./ui";

interface TranscriptPolishReviewProps {
  review: TranscriptPolishReviewState;
  speakers: Speaker[];
  onClose?: () => void;
  discarding?: boolean;
  onCancelDiscard?: () => void;
  onConfirmDiscard?: () => void;
}

export function TranscriptPolishReview({
  review,
  speakers,
  onClose,
  discarding = false,
  onCancelDiscard,
  onConfirmDiscard,
}: TranscriptPolishReviewProps) {
  const {
    proposal,
    draft,
    setDraft,
    editing,
    setEditing,
    original,
    setOriginal,
    busy,
    error,
    notice,
    pending,
    accepted,
    stale,
    dirty,
    editable,
    generate,
    save,
    discard,
  } = review;
  const available = Boolean(review.context?.available);

  return (
    <div className="polish-modal-card">
      {/* 1. Modal Header */}
      <div className="polish-modal-header">
        <div className="polish-header-left">
          <div className="polish-sparkle-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
              <line x1="19" y1="5" x2="19" y2="9" />
              <line x1="17" y1="7" x2="21" y2="7" />
            </svg>
          </div>
          <div className="polish-title-wrap">
            <div className="polish-title-row">
              <h2 id="polish-title" className="polish-title">
                {accepted ? "Transcript đã chốt" : "Làm mịn transcript bằng AI"}
              </h2>
              {accepted ? (
                <span className="polish-status-pill pill-success">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Đã hoàn tất
                </span>
              ) : proposal?.job.status === "completed" ? (
                <span className="polish-status-pill pill-warning">
                  <span className="polish-status-dot" />
                  Đã làm mịn · Chờ duyệt
                </span>
              ) : proposal ? (
                <Status value={proposal.job.status} />
              ) : null}
            </div>
            <p className="polish-subtitle">
              AI đề xuất chuẩn hóa câu từ và lỗi chính tả, bản gốc luôn được lưu an toàn trong lịch sử.
            </p>
          </div>
        </div>

{/* Close button removed in favor of topbar back button */}
      </div>

      {/* 2. Banner Notices */}
      <div className="polish-banner-zone">
        {discarding && (
          <div className="polish-callout-banner banner-warning">
            <div className="polish-callout-content">
              <strong>Bỏ thay đổi chưa lưu?</strong>
              <span>Có chỉnh sửa chưa được lưu. Nếu đóng ngay, các thay đổi sẽ bị mất.</span>
            </div>
            <div className="polish-callout-actions">
              <button type="button" className="polish-btn-pill" onClick={onCancelDiscard}>
                Tiếp tục sửa
              </button>
              <button type="button" className="polish-btn-pill pill-danger" disabled={busy} onClick={onConfirmDiscard}>
                Bỏ và đóng
              </button>
            </div>
          </div>
        )}

        {notice && !discarding && (
          <div className="polish-callout-banner banner-success">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{notice}</span>
          </div>
        )}

        {dirty && !discarding && (
          <div className="polish-callout-banner banner-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Có sửa đổi chưa lưu. Lưu bản nháp hoặc chốt để áp dụng thay đổi.</span>
            <button type="button" className="polish-inline-link-btn" disabled={busy} onClick={discard}>
              Hủy sửa
            </button>
          </div>
        )}

        {error && (
          <div className="polish-callout-banner banner-danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{error}</span>
            <button type="button" className="polish-inline-link-btn" onClick={review.retry} disabled={busy || dirty}>
              Tải lại
            </button>
          </div>
        )}

        {stale && (
          <div className="polish-callout-banner banner-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Transcript nguồn đã thay đổi. Cần tạo lại bản làm mịn trước khi chốt.</span>
          </div>
        )}
      </div>

      {/* 3. Loading / Empty States */}
      {proposal === undefined && !error && (
        <div className="polish-loading-box">
          <Loading label="Đang kiểm tra dữ liệu làm mịn transcript…" />
        </div>
      )}

      {pending && proposal && (
        <div className="polish-loading-box">
          <Loading label={proposal.job.status === "retrying" ? "AI đang thử lại xử lý…" : "Đang làm mịn transcript bằng AI… Bản gốc đã được lưu an toàn."} />
        </div>
      )}

      {proposal?.job.status === "failed" && (
        <div className="polish-empty-box">
          <p className="polish-empty-msg">{proposal.job.error?.message ?? "Không thể hoàn thành làm mịn transcript."}</p>
          <span className="polish-empty-sub">Bạn có thể thử lại bằng nút bên dưới hoặc sửa transcript trực tiếp bằng tay.</span>
        </div>
      )}

      {/* 4. Main Proposal Content */}
      {proposal?.job.status === "completed" && (
        <>
          {/* Toolbar */}
          <div className="polish-toolbar">
            <div className="polish-toolbar-left">
              <button
                type="button"
                className={`polish-action-pill ${original ? "is-active" : ""}`}
                onClick={() => setOriginal((v) => !v)}
                title={original ? "Ẩn văn bản gốc" : "Hiển thị so sánh với văn bản gốc"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>{original ? "Ẩn đối chiếu gốc" : "Đối chiếu bản gốc"}</span>
              </button>

              {editable && !accepted && !stale && (
                <button
                  type="button"
                  className={`polish-action-pill ${editing ? "is-active" : ""}`}
                  disabled={busy}
                  onClick={() => setEditing((v) => !v)}
                  title={editing ? "Xem trước bản nháp" : "Chỉnh sửa trực tiếp nội dung"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  <span>{editing ? "Xem trước" : "Sửa transcript"}</span>
                </button>
              )}
            </div>

            <div className="polish-toolbar-right">
              <span className="polish-counter-badge">
                {proposal.segments.length} đoạn nội dung
              </span>
            </div>
          </div>

          {/* Segments Cards */}
          <div className="polish-segments-container">
            {proposal.segments.map((row, index) => {
              const speaker = speakers.find((s) => s.id === row.speaker_id);
              const speakerName = speaker?.name ?? "Người nói";
              const timeDisplay = `${formatTimestampInput(row.start_ms)} – ${formatTimestampInput(row.end_ms)}`;
              const currentText = draft[row.logical_segment_id] ?? row.text;

              return (
                <article className="polish-segment-card" key={row.logical_segment_id}>
                  {/* Card Meta Topbar */}
                  <div className="polish-card-header">
                    <div className="polish-card-speaker">
                      <span className="polish-avatar-circle">{speakerName.charAt(0).toUpperCase()}</span>
                      <strong className="polish-speaker-title">{speakerName}</strong>
                    </div>

                    <div className="polish-card-tags">
                      <span className="polish-time-tag">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {timeDisplay}
                      </span>
                      <span className="polish-seq-tag">Đoạn {index + 1}</span>
                    </div>
                  </div>

                  {/* Original comparison box */}
                  {original && (
                    <div className="polish-original-box">
                      <div className="polish-box-label label-original">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span>Bản ghi âm gốc</span>
                      </div>
                      <p className="polish-original-content">{row.original_text}</p>
                    </div>
                  )}

                  {/* Polished / Edited content */}
                  <div className={`polish-result-box ${original ? "is-comparing" : ""}`}>
                    {original && (
                      <div className="polish-box-label label-polished">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
                        </svg>
                        <span>Bản đã làm mịn bởi AI</span>
                      </div>
                    )}

                    {editing && !accepted && !stale ? (
                      <textarea
                        rows={3}
                        maxLength={50000}
                        disabled={busy}
                        className="polish-editor-textarea"
                        value={currentText}
                        onChange={(e) =>
                          setDraft((current) => ({ ...current, [row.logical_segment_id]: e.target.value }))
                        }
                      />
                    ) : (
                      <p className="polish-result-paragraph">{currentText}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* 5. Modal Footer */}
      <div className="polish-modal-footer">
        <div className="polish-footer-left">
          <span className="polish-security-hint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Bản gốc luôn được lưu trữ an toàn trong lịch sử phiên bản
          </span>
        </div>

        <div className="polish-footer-right">
          {editing && editable && !accepted && !stale && (
            <button
              type="button"
              className="polish-footer-btn btn-secondary"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Lưu bản nháp
            </button>
          )}

          {editable && !accepted && !stale && proposal?.job.status === "completed" && (
            <button
              type="button"
              className="polish-footer-btn btn-primary"
              disabled={
                busy ||
                review.tool.disabled ||
                Boolean(review.queryError) ||
                proposal.segments.some((row) => !(draft[row.logical_segment_id] ?? row.text).trim())
              }
              onClick={() => void save(true)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{busy ? "Đang lưu…" : "Chốt transcript"}</span>
            </button>
          )}

          {editable && !pending && (!proposal || proposal.job.status === "failed" || stale) && (
            <button
              type="button"
              className="polish-footer-btn btn-primary"
              disabled={busy || !available || dirty || review.tool.disabled}
              onClick={() => void generate()}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
              </svg>
              <span>{busy ? "Đang tạo yêu cầu…" : "Làm mịn transcript bằng AI"}</span>
            </button>
          )}

{/* Đóng button removed in favor of topbar back button */}
        </div>
      </div>
    </div>
  );
}
