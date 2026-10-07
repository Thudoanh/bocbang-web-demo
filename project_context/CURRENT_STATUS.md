# Current Status

_Cập nhật lần cuối: 2026-10-07_

## Done

- Cuộc họp and Lịch sử are now one screen. The unified view keeps the primary
  create actions and adds debounced search, status/source filters, full meeting
  metadata, media management and deletion. The duplicate sidebar item and old
  page component are removed; `/history` remains a compatibility alias.

- The meeting workspace has a second, screenshot-driven refinement pass. Its
  transcript is now a compact continuous list instead of oversized cards,
  segment actions stay in the content column and recede until hover/focus on
  desktop, sidebar/right-panel widths are reduced, and duplicate Công cụ/Người
  nói tabs are removed. The backend merge constraint is shown in Vietnamese.
  Type-check/build, Docker health, HTTP smoke and light/dark browser checks pass.

- The complete frontend presentation has been redesigned around a minimal,
  action-first system. Navigation is reduced to three primary destinations plus
  contextual meeting tools; duplicate recent/search/sidebar controls are gone.
  Meeting list and creation are now separate views, page copy and secondary
  panels are trimmed, and auth, upload, transcript, speakers, translation,
  summary, export/share, history, settings and public share use one responsive
  surface/form/status system. Light/dark modes and keyboard focus remain
  supported. Type-check, production build, Docker build, desktop light/dark and
  390px mobile browser checks pass.

- Realtime AssemblyAI connection no longer fails validation when a meeting
  title is supplied as a keyterm. Streaming `keyterms_prompt` is now encoded as
  the JSON array required by the upstream handshake instead of repeated scalar
  query parameters. All 14 provider adapter tests pass, the API image is
  rebuilt/healthy, and a live open/close streaming handshake with a Vietnamese
  keyterm succeeds without sending audio.

- Google login is operational again end-to-end. The frontend now checks API
  readiness before leaving the login page and shows a Vietnamese recovery
  message instead of sending users to a connection-refused page. Docker
  Desktop's stale local IPC directories were recoverably isolated and the full
  Compose stack rebuilt; API/frontend health checks pass. The OAuth start route
  returns a signed-state `307` to Google, and a browser click reaches Google's
  `Sign in` page for `bocbang-web`.

- Light/dark theme is now implemented across authenticated pages, auth flows
  and public share pages. The accessible toggle updates `data-theme`, native
  `color-scheme` and browser theme color; the explicit preference persists in
  `localStorage` and synchronizes across tabs. A pre-render initializer avoids
  a light-theme flash. Dark surfaces, forms, status elements and content cards
  now have explicit contrast-safe overrides. Frontend type-check and production
  build pass; browser checks confirmed light → reload and dark → reload state.

- STT accuracy/meeting-state repair completed after rereading the BA and tracing
  a real failed upload. The uploaded `IMG_9721.MP4` normalized to 14.02 seconds
  of digital silence (`-91 dB`), explaining AssemblyAI's valid zero-word
  response; the worker now rejects this before a paid call with
  `MEDIA_NO_AUDIBLE_AUDIO`. Batch STT moved from deprecated
  `universal-3-pro` to `universal-3-5-pro` plus `universal-2` fallback and now
  respects the meeting diarization option/context. Realtime now declares PCM16,
  uses Universal 3.6 `max_accuracy` with meeting turn timing, enables speaker
  labels, applies final speaker revisions, records word confidence instead of
  end-of-turn confidence, and reaches `completed` only after final provider
  output; silence fails explicitly. Backend and frontend also enforce the BA's
  separate realtime/upload modes instead of allowing a file upload into a
  realtime meeting (the path used by the failed sample). Full backend suite
  reports 58 passed; frontend type-check/build pass.

- Local full-stack regression pass now covers the real Docker frontend/API,
  PostgreSQL, Redis, worker and reconciler. Browser checks passed for login,
  meeting creation/detail, History search, Settings, no-transcript states and
  viewer permission guards. API smoke checks confirmed owner/editor/viewer ACL
  (`200/403/401` boundaries). Fixed export integration-test isolation from an
  inherited Redis environment, disabled translation/summary/export without a
  transcript, blocked viewer uploads/exports in the UI, stopped repeated
  export-completion state updates, and upgraded
  `source-map-js` to the patched release. Backend is green at 54 tests;
  frontend type-check/build and `npm audit` pass with zero vulnerabilities.

- Realtime recording now supports optional, transient VI ↔ EN translation on
  the existing authenticated WebSocket. Final STT segments are translated on a
  separate per-session queue, rendered under their source segment, and can be
  hidden to stop provider calls. Re-enabling backfills missing trusted segment
  IDs without persisting or replacing the existing batch translation feature.
  Frontend production build and seven focused realtime WebSocket tests pass.

- Realtime AssemblyAI now steers every stream to the meeting language with a
  single `language_codes` value, uses meeting context, and defaults to Universal
  3.6 in `max_accuracy` mode. Unsupported languages fail
  before an upstream connection is opened. Browser microphone capture now uses
  AudioWorklet, mono 16 kHz PCM16 chunks, browser audio cleanup constraints,
  stateful resampling and explicit pause/stop flushing. Docker frontend/API
  builds, 18 focused provider/realtime tests and HTTP readiness smoke checks
  passed; the formerly failing export/queue test is now isolated and the full
  backend suite passes.

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
- Xác minh frontend gần nhất: `npm.cmd run check`, production build và Docker
  image build đều thành công sau browser regression ngày 2026-10-07.

## In progress

- Chưa chạy lượt microphone realtime mới có tính phí sau các sửa đổi STT. Hai
  transcript upload provider đã được đọc lại và đều xác nhận file nguồn im lặng;
  chưa có mẫu tiếng Việt có lời nói rõ để đo WER/latency sau sửa đổi.

## Next

1. Bổ sung pagination/count cho History nếu số lượng meeting tăng; API hiện có
   `limit/offset` và server-side filtering nhưng chưa trả tổng số/cursor.
2. Chốt và thiết kế migration/API cho default language, diarization, số điện
   thoại, storage/retention metadata trước khi thêm các field settings còn lại.
3. Chạy browser/microphone E2E với AssemblyAI thật trên các mẫu tiếng Việt rõ,
   có tiếng ồn nhẹ và có thuật ngữ tiếng Anh xen kẽ; ghi nhận accuracy/latency.
4. Bổ sung frontend component/E2E tests tự động cho permission và trạng thái
   thiếu transcript; hiện các ca này đã được browser regression thủ công.
5. Dọn repository-wide Ruff debt để có thể bật lint toàn bộ backend làm quality
   gate; test file export vừa sửa đã qua Ruff riêng.

## Blockers / risks

- Provider credentials đã được cấu hình trong môi trường local, nhưng chưa chạy
  browser/microphone E2E có tính phí với AssemblyAI sau thay đổi model/context/
  diarization; không coi unit tests hoặc handshake giả lập là xác minh accuracy.
- Upload → STT, authenticated audio playback, provider translation/summary and
  generated export download were not exercised against paid providers in this
  pass. Their contracts/unit tests pass, but live quality and latency remain a
  release risk.
- Repository-wide Ruff is still red on pre-existing formatting/style debt even
  though the full backend pytest suite is green.
