# Implementation plan — hiện trạng và bước tiếp theo

_Đối chiếu codebase: 2026-10-08._

## Các phần đã có

| Phạm vi | Implementation hiện tại |
| --- | --- |
| Foundation | React/TS/Vite, FastAPI, SQLAlchemy/Alembic, health/ready, Docker Compose, backend/frontend Dockerfiles. |
| Auth | Email/password, OTP qua SMTP, recovery, Google OAuth, JWT access/refresh, full-name update. |
| Meeting/ACL | Owner và collaborators read/comment/edit, filter list, CRUD, member/share management. |
| Media/queue | ffprobe validation, FFmpeg normalization, local/S3 storage, durable jobs, Dramatiq/Redis worker, retry/reconciler. |
| STT | Speechmatics batch/realtime, AssemblyAI retryable fallback, VI/EN và diarization. |
| Voice profile | Personal/guest enrollment, tối đa ba identifiers/profile, known-speaker naming, migration 0011/0012. |
| Transcript | Current projection, immutable history/edit events/checkpoints, split/merge/delete/speaker edit và rollback. |
| Realtime | AudioWorklet PCM16 16 kHz, pause/resume/stop, partial/final, correction/reconnect scope, transient translation. |
| AI | Gemini/Groq dịch VI ↔ EN, summary ba template/output VI-EN, immutable summary versions. |
| Export/share | Sáu export formats qua worker, authenticated download, comments, public current transcript. |
| Playback | Signed URL/ticket, local Range proxy, uploaded-media player sync/seek. |

Đây là trạng thái implementation, không thay cho acceptance với provider thật.
Chi tiết test lịch sử nằm trong [Task Log](../../project_context/TASK_LOG.md).

## Công việc tiếp theo

1. Sửa media download handler đang dùng `request` chưa khai báo, xác minh local/
   S3 download. Đây là bug ghi nhận từ source trong đợt đồng bộ tài liệu.
2. Chạy browser E2E upload → STT → edit/rollback → playback → AI → export;
   kiểm tra ACL, Google/OTP, share expiry/revoke, signed URL expiry.
3. Kiểm thử realtime Speechmatics từ microphone thực: VI/EN, hai người nói,
   known/unknown speakers, noise, pause/resume/stop, reconnect và fallback.
4. Xác minh PostgreSQL migration/test và lint trong môi trường độc lập; không
   đồng nhất frontend build với backend/provider verification.
5. Bổ sung History pagination/count và settings preference/retention contracts
   nếu được đưa vào scope.
6. Thiết kế share-token scope cho summary/translation/media hay writes nếu cần;
   hiện chỉ metadata/current transcript read-only.
7. Cấu hình deployment public, backups, HTTPS/WSS, SMTP/OAuth/provider secrets,
   private S3 và migration rollout. Render là target thiết kế; chưa có manifest.

## Quy tắc thực hiện

Inspect source và tài liệu domain; implement với capability/ACL thật; xác minh
đúng phạm vi; cập nhật API/ERD/config docs nếu contract thay đổi. Sau task có sửa
repo, cập nhật `CURRENT_STATUS.md` và thêm `TASK_LOG.md`. Không fake AI/STT,
không đưa secrets vào frontend, không bỏ acceptance criteria.
