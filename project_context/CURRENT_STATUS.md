# Current Status

_Cập nhật lần cuối: 2026-10-05_

## Done

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
5. Register/configure STT streaming + batch, TranslationProvider và LLMProvider
   thật; chạy worker/end-to-end tests với provider được chọn.
6. Chạy backend `pytest`, `ruff check .`, Alembic migration validation và
   browser E2E trên standard CPython + isolated PostgreSQL.

## Blockers / risks

- Chưa có provider production được cấu hình/đăng ký trong môi trường hiện tại;
  capability-gated UI sẽ không thể thực hiện STT/AI thật cho tới khi có adapter
  và credentials backend.
- Public share chưa thể công khai transcript hoặc AI result vì backend không
  cấp token-scoped result endpoints; không được mở endpoint authenticated hiện
  có mà không thiết kế ACL riêng.
- Audio playback BA vẫn bị chặn bởi thiếu media stream/download contract.
- Backend test/lint có thể cần standard CPython và database độc lập tùy môi
  trường local/deploy; không coi frontend build là E2E verification.
- Browser automation was unavailable in the current agent environment; visual
  comparison is recorded as static QA, not an interactive acceptance result.
