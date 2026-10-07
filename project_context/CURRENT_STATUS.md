# Current Status

_Cập nhật lần cuối: 2026-10-07_

## Done

- Realtime speaker diarization now honors the meeting option in AssemblyAI,
  preserves turn labels and maps unassigned speech to no speaker. New meeting
  speakers receive `Người nói N` names, final events include persisted speaker
  IDs, and the frontend refreshes transcript/speakers/history on final or
  correction events. Provider SpeakerRevision deltas are applied in order and
  recorded as transcript revisions; manual assignments/unassignments and
  split/merge/delete edits are protected. Each upstream connection scopes its
  labels separately and starts a fresh STT snapshot, preserving earlier session
  history; saved timestamps continue from retained meeting duration. No database
  migration is required. All 83 backend tests and frontend production build
  pass. Focused lint passes (pre-existing E501/UP037 excluded in legacy files);
  realtime service/route and new regression tests also pass without exclusions.
  Browser/microphone verification and real two-voice accuracy remain pending;
  README contains the smoke-test procedure. Source changes require rebuilding
  the Docker stack before testing the container-served application.

- Export workers now read immutable transcript revisions through a shared
  snapshot/edit-event reader also used by history and rollback. Edited revisions
  without snapshots, legacy snapshots, checkpointed revisions and exports queued
  before later edits are covered by regression tests. All 66 backend tests pass;
  focused lint passes (pre-existing long lines in `transcripts.py` excluded).
  The local worker was restarted after confirming no executing jobs or Redis
  messages. Six fresh exports of the previously failing revision completed via
  real Redis/Dramatiq and their stored downloads were verified; API is ready.
  Browser interaction remains unverified; export UI error display/completion
  effect issues are a separate follow-up. No database migration was needed.

- Realtime recording now supports optional, transient VI ↔ EN translation on
  the existing authenticated WebSocket. Final STT segments are translated on a
  separate per-session queue, rendered under their source segment, and can be
  hidden to stop provider calls. Re-enabling backfills missing trusted segment
  IDs without persisting or replacing the existing batch translation feature.
  Frontend production build and seven focused realtime WebSocket tests pass.

- Realtime AssemblyAI now steers every stream to the meeting language with a
  single `language_codes` value, keeps the language-specific verbatim prompt,
  and defaults to Universal 3.6 in `balanced` mode. Unsupported languages fail
  before an upstream connection is opened. Browser microphone capture now uses
  AudioWorklet, mono 16 kHz PCM16 chunks, browser audio cleanup constraints,
  stateful resampling and explicit pause/stop flushing. Docker frontend/API
  builds, 18 focused provider/realtime tests and HTTP readiness smoke checks
  passed; the export/queue test failure observed then is now fixed by the
  immutable-revision export change above.

- Added a local Docker Compose stack for the React frontend, PostgreSQL, Redis,
  Alembic migrations, API, worker and reconciler. Another machine needs only
  Docker, source and the root `.env`. Frontend uses a Node build stage and Nginx
  with SPA fallback; public build arguments are isolated from backend secrets.
  Shared backend image includes FFmpeg/ffprobe and
  Unicode PDF fonts; local media and database/queue data persist in volumes.
  README documents setup, rebuilds, environment overrides and shutdown.
  Compose configuration and startup/storage assertions passed. Frontend image
  build and container HTTP/SPA/assets smoke checks passed; full backend/provider
  integration checks remain pending.

- Backend queue worker foundation now uses Dramatiq + Redis: durable Job
  lifecycle fields and retry schedule, Redis-only enqueue after commit,
  separate consumer and reconciliation entrypoints, and media/STT, AI, and
  export execution outside the FastAPI process.

- Frontend React + TypeScript + Vite đã dùng REST/WebSocket backend thật, có
  auth/OTP/recovery/Google OAuth, meeting ACL, realtime recording, upload job,
  transcript versioning, comments và export download có xác thực.
- UI shell đã được căn chỉnh theo BA references trong `docs/ui/references/`:
  sidebar, app bar, auth shell, panel/form/button/status token và responsive
  desktop-first layout.
- Phase 0 đã hoàn tất: mapping BA/API/frontend, quyết định contract đang dùng
  và các API gap được ghi tại `docs/planning/phase-0-api-gap.md`.
- Phase 1 đã hoàn tất ở frontend:
  - tách tạo meeting `realtime` và `upload`;
  - realtime có timer, start/pause/resume/stop, partial/final transcript và
    trạng thái lỗi/kết nối;
  - upload theo dõi `queued/processing/completed/failed`, chỉ mở transcript
    sau khi job hoàn tất;
  - transcript sửa text/timestamp/speaker, split/merge, delete có confirm,
    và cập nhật immutable version.
- Phase 2 đã hoàn tất ở frontend:
  - route theo meeting cho speaker management, translation, summary/minutes,
    export/share;
  - translation và summary tạo job thật, polling trạng thái và đọc kết quả từ
    backend;
  - export chọn format/options thực có, tải blob bằng Authorization;
  - share link tạo từ backend và có public metadata page `/share/:token`.
- Phase 3 đã hoàn tất cho contract/UI hiện có:
  - `GET /meetings` nhận `q`, `status`, `source_type`; History gửi filter
    lên server thay vì lọc toàn bộ dữ liệu trong browser;
  - owner có thể xem/xóa tệp media riêng và xóa meeting qua confirmation;
  - `PATCH /auth/me` cho phép cập nhật tên hồ sơ, đồng bộ session frontend.
- Phase 4 đã hoàn tất ở mức code/build QA: shared SVG icon primitive thay cho
  glyph navigation/auth, responsive/static reference checklist và acceptance
  matrix tại `docs/planning/phase-4-qa.md`.
- Backend hiện có FastAPI modular monolith, async SQLAlchemy/Alembic domain,
  meeting ACL, auth, upload/media job, realtime STT boundary, immutable
  transcript/speaker APIs, translation/summary, exports, share links và
  performance instrumentation/audit tài liệu.
- Durable media, normalized media and exports now use a local/S3-compatible
  storage boundary. Production uses private object storage and short-lived
  presigned downloads; no persistent media depends on the API filesystem.
- LLM summary và dịch segment VI ↔ EN có thể dùng Groq làm primary hoặc
  fallback sau Gemini qua biến môi trường backend; key Groq không bao giờ được
  gửi ra frontend.
- Xác minh frontend gần nhất: `npm.cmd run build` thành công sau Phase 2.

## In progress

- Chưa có lượt kiểm thử browser/E2E với backend/provider thật cho các luồng
  realtime, upload processing, translation, summary, export và public share.

## Next

1. Bổ sung pagination/count cho History nếu số lượng meeting tăng; API hiện có
   `limit/offset` và server-side filtering nhưng chưa trả tổng số/cursor.
2. Chốt và thiết kế migration/API cho default language, diarization, số điện
   thoại, storage/retention metadata trước khi thêm các field settings còn lại.
3. Mở rộng public share contract: endpoint capability-link hiện chỉ trả meeting
   metadata + permission; cần read-only transcript/summary/translation scoped
   by token để share page có thể hiển thị nội dung nhạy cảm an toàn.
4. Implement `AudioPlayer` đồng bộ segment against the authenticated local
   proxy / short-lived S3 playback URL. Không fake player ở frontend.
5. Chạy browser/microphone E2E với AssemblyAI thật trên các mẫu tiếng Việt rõ,
   có tiếng ồn nhẹ và có thuật ngữ tiếng Anh xen kẽ; ghi nhận accuracy/latency.
6. Chạy backend `pytest`, `ruff check .`, Alembic migration validation và
   browser E2E trên standard CPython + isolated PostgreSQL.

## Blockers / risks

- Docker Engine is now reachable with elevated Docker access; the frontend
  container is verified. Full-stack migration/API/worker/upload/export runtime
  checks remain pending.

- Provider credentials đã được cấu hình trong môi trường local, nhưng chưa chạy
  browser/microphone E2E có tính phí với AssemblyAI sau thay đổi language
  steering; không coi unit tests hoặc handshake giả lập là xác minh accuracy.
- Public share chưa thể công khai transcript hoặc AI result vì backend không
  cấp token-scoped result endpoints; không được mở endpoint authenticated hiện
  có mà không thiết kế ACL riêng.
- Audio playback BA vẫn bị chặn bởi thiếu media stream/download contract.
- Backend test/lint có thể cần standard CPython và database độc lập tùy môi
  trường local/deploy; không coi frontend build là E2E verification.
- Browser automation was unavailable in the current agent environment; visual
  comparison is recorded as static QA, not an interactive acceptance result.
