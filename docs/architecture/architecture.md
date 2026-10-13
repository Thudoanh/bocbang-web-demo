# Kiến trúc hệ thống

_Đối chiếu codebase: 2026-10-08._

## Thành phần đang chạy

Ứng dụng là modular monolith FastAPI với worker tách process. React/TypeScript
gọi REST và WebSocket dưới `/api/v1`. PostgreSQL lưu domain data và trạng thái
job; Redis chuyển message chỉ chứa `job_id`, không thay database. Reconciler
phát lại queued/due-retrying job sau sự cố publish/delivery.

| Thành phần | Source / nhiệm vụ |
| --- | --- |
| Frontend | `frontend/src/`, React + TypeScript + Vite; Docker phục vụ bằng Nginx. |
| API | `backend/app/api/v1/routes/`, auth, ACL, meeting, upload, transcript, AI request, export/share và voice profiles. |
| Domain service | `backend/app/services/`; kiểm tra quyền và transaction. |
| Persistence | `backend/app/models/`, async SQLAlchemy; Alembic head `20261008_0012`. |
| Worker | `app.workers.worker`, Dramatiq/Redis, media/STT, translation, summary, export. |
| Reconciler | `app.workers.reconciler`, recovery durable job và retry schedule. |
| Provider | `app/providers/`, contracts và adapters STT/translation/LLM/storage/email. |

## Luồng xử lý

Upload: API kiểm tra ACL `edit`, stream tệp tạm, giới hạn size, ffprobe duration/
validity, lưu original qua storage boundary rồi commit media/job. Worker nhận
job, tải file tạm, FFmpeg chuẩn hóa WAV mono PCM16 16 kHz, lưu normalized media,
gọi STT và lưu transcript. Status job:
`queued → processing → completed`, hoặc `retrying/failed`.

Translation/summary request chụp input transcript version, tạo job và trả 202;
export trả export response kèm `job_id`. Worker đọc immutable revision theo
snapshot/edit events, giữ output provenance ngay cả khi transcript được sửa
sau lúc enqueue. API không xử lý các job inline.

Realtime: browser AudioWorklet → PCM16 mono 16 kHz → authenticated WebSocket →
STT stream. Partial chỉ truyền socket; final được lưu. Mỗi kết nối upstream
có speaker scope riêng và final timestamp tiếp tục từ retained meeting duration.
Stop/disconnect để meeting `processing`; không tự đánh dấu completed hay tạo
upload job. Dịch realtime chạy queue tạm theo connection, không lưu DB.
Enrollment voiceprint gọi provider trực tiếp qua API; không phải durable job.

## Provider và nhận diện người nói

Cấu hình mẫu chọn Speechmatics làm batch/realtime primary, AssemblyAI fallback
chỉ khi lỗi retryable lúc mở stream hoặc batch. Không chuyển provider giữa
stream đã mở. Speechmatics dùng known speakers từ voice profiles của owner,
members và khách thuộc meeting; người chưa nhận diện giữ nhãn `Người nói N`.
AssemblyAI fallback không nhận diện tên từ Speechmatics identifiers.

Gemini/Groq có adapter dịch VI ↔ EN và summary `general/briefing/voting`;
summary bắt buộc output language VI/EN. Capability endpoint quyết định khả năng
sử dụng thực tế; credentials chỉ ở backend. Xem [provider contracts](provider-architecture.md).

## ACL, versioning và public share

ACL theo meeting: `owner > edit > comment > read`; không có global admin.
Owner quản lý members/share và xóa meeting/media. Share token lưu hash, được
kiểm tra expiry/revocation, chỉ cấp metadata và current transcript qua public
endpoints. Quyền ghi của collaborators vẫn dùng authenticated user ACL.

Current transcript dùng `current_segments` projection. Lịch sử dùng STT/
checkpoint snapshots và append-only `transcript_edit_events`; edit và rollback
tạo revision mới. Provider speaker correction tôn trọng manual edit/split/
merge/delete. Summary regeneration thêm immutable version; partial realtime
không nằm trong lịch sử. Xem [ERD](erd.md) và [API](api-spec.md).

## Storage và xóa dữ liệu

Local storage dùng cho host/Compose; API/worker cần cùng thư mục hoặc volume.
S3 adapter đã có và dùng bucket private, object keys trong DB. Playback trả
presigned URL S3 hoặc ticket local có TTL; player phát retained uploaded media,
seek theo segment. Realtime capture hiện không lưu audio để nghe lại.

Xóa media: owner được kiểm tra, xóa original/normalized object, soft-delete
record và fail các job còn hoạt động gắn media; transcript được giữ.
Xóa meeting: route kiểm tra owner, purge media/export objects trước rồi xóa DB
với cascade. Cleanup storage chạy trực tiếp, chưa có cleanup queue/audit riêng;
DB và object storage không thuộc cùng atomic transaction.

## Runtime và giới hạn

Local stack đã có `compose.yaml`, hai Dockerfile, PostgreSQL, Redis, migration,
API, worker, reconciler, frontend. Render là target đã chọn trong thiết kế,
chưa có `render.yaml` hay quy trình tự deploy trong repo.

`/health` là liveness; `/ready` chỉ kiểm tra database, không kiểm tra Redis,
worker hoặc provider. Public summary/translation/media, token-based writes,
settings preference/retention metadata và browser E2E đầy đủ còn cần làm.
Xem [triển khai](../deployment/deployment.md) và
[Current Status](../../project_context/CURRENT_STATUS.md).
