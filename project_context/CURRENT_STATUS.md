# Current Status

_Cập nhật lần cuối: 2026-10-12 — sửa ô realtime bị kẹt ở trạng thái nhận diện._

## Done

- Đã sửa partial bị giữ mãi khi final rút ngắn timestamp: đối chiếu chữ đã
  xác nhận và SDK utterance/turn boundary; không chốt nhầm partial mới hơn.
  Frontend thay preview theo final turn ID, chống partial cũ xuất hiện lại
  sau fetch. Khi dừng/lỗi terminal, draft còn lại ghi rõ chưa xác nhận/chưa lưu.
- Speechmatics realtime gom các fragment liên tiếp cùng người nói/ngôn ngữ
  vào preview tích lũy có turn ID ổn định. Timestamp/text corrections thay
  snapshot; partial chưa xác nhận hoãn final timer. Giữ ranh giới người nói/
  khoảng ngừng, xử lý late final và chống partial cũ/reconnect xóa nhầm ô.
- Đã thêm regression tests và kiểm tra adapter → WebSocket → SQLite: ba mảnh
  từ được lưu thành một segment. Không sửa dữ liệu transcript đã có.
- React + TypeScript + Vite frontend đang dùng API thật: auth/OTP/recovery/
  Google OAuth, meeting ACL, History filter và full-name update.
- FastAPI modular monolith với async SQLAlchemy; Alembic head `20261008_0012`.
- Upload/media: size/duration validation, FFmpeg normalization, local/S3 storage,
  durable job; Redis/Dramatiq worker và reconciler chạy process riêng.
- Speechmatics batch/realtime là primary trong env mẫu; AssemblyAI fallback
  khi lỗi retryable lúc mở stream/batch, không nhận diện tên theo voiceprints.
- Personal/guest voice profiles: sample 10–25 giây, tối đa ba identifiers/profile,
  tối đa 50 identifiers/session round-robin. Migration 0012 bỏ MFCC cũ.
- Realtime PCM16 mono 16 kHz AudioWorklet, start/pause/resume/stop, partial/final,
  speaker correction bảo vệ manual edits, reconnect scope/timestamps.
- Optional realtime VI ↔ EN translation dùng queue theo socket, không lưu DB.
- Transcript edit/split/merge/delete/speaker assignment, current projection,
  snapshots/edit events/checkpoints, history và rollback revision.
- Uploaded-media player đã có signed playback URL/ticket, Range, seek theo
  segment và highlight đoạn đang phát. Realtime capture không lưu audio replay.
- Translation và summary Gemini/Groq, summary output language VI/EN; export sáu
  formats qua worker đọc immutable input revision.
- Comments, members và share management; public `/share/:token` đã hiển thị
  metadata + current transcript qua token-scoped read endpoint.
- Docker Compose có PostgreSQL, Redis, migrate, API, worker, reconciler,
  frontend; local volumes persist database/queue/media.
- Đã đồng bộ README, env example, kiến trúc/provider/API/ERD, deployment/config,
  migration guide, planning/QA và trạng thái dự án theo source hiện tại.
- README root đã rút gọn thành hướng dẫn local bằng Docker: tạo env, điền key
  hoặc tắt AI, khởi động, lấy OTP từ log và các lệnh quản lý stack thường dùng.
- `.env` local đã đối chiếu với Settings/env example: thêm 17 biến queue/worker,
  storage/realtime/Speechmatics, chuẩn hóa bốn S3 aliases. Giữ nguyên giá trị
  đã có, credentials và model overrides.
- Đã cập nhật cấu hình STT trong `.env` dự án từ env tham chiếu: Speechmatics
  primary, AssemblyAI fallback và Speechmatics key; giữ các tuning mặc định
  hiện có cùng mọi cấu hình khác. Chưa recreate/restart stack.

## Verification

- Lượt sửa ô nhận diện: 67 focused backend tests và 14 frontend tests pass;
  TypeScript/Vite build, Ruff adapter/Speechmatics tests, F/I realtime tests,
  `git diff --check` pass. WebSocket/SQLite test kiểm tra final timestamp ngắn
  hơn preview. Các provider được mô phỏng; bản sửa này chưa rebuild Docker.
- Bản sửa phân mảnh trước đã build API/frontend và chạy migration thành công;
  API/frontend/PostgreSQL/Redis healthy, `/ready` ready, frontend HTTP 200,
  capabilities báo Speechmatics streaming/diarization. Người dùng báo chạy ổn
  nhưng còn ô nhận diện; lượt sửa mới cần người dùng rebuild và thử lại.
- Lượt sửa 2026-10-12: 61 backend tests trong Speechmatics/provider/realtime/
  speaker suites và 10 frontend reducer tests pass; TypeScript/Vite build pass.
  Ruff pass cho adapter/Speechmatics tests, F/I pass cho realtime tests;
  `git diff --check` pass. Dependencies test nằm trong `.venv-stt`/`node_modules`
  (Git ignored). Async tests chạy ngoài Windows sandbox để tránh asyncio bị treo.
  Các provider được mô phỏng; chưa gọi Speechmatics thật, chưa restart Docker.
- Task trước ghi nhận 93 backend tests, frontend build, Docker migration/health
  và Speechmatics batch/realtime smoke test bằng file thật. Xem `TASK_LOG.md`
  để biết phạm vi và thời điểm; không coi đó là test mới trong đợt sửa tài liệu.
- Đợt này chỉ sửa tài liệu và config example; xác minh đường dẫn, nội dung
  cấu hình, route/schema/model references và diff. Không chạy provider/browser
  E2E hay thay đổi runtime code.
- Lượt rút gọn README chỉ sửa tài liệu; kiểm tra liên kết, code fences và lệnh
  theo Compose/provider config. Không khởi động lại stack hoặc sửa `.env`.
- Lượt cập nhật `.env`: đủ biến trong env example, không trùng key, kiểm tra
  bảo toàn giá trị có sẵn. Python virtualenv đã validate Settings/queue và
  khởi tạo STT/translation/LLM/email adapter thành công; không gọi provider hay
  kết nối database/Redis, không restart stack.
- Lượt chuyển Speechmatics: kiểm tra key khớp file tham chiếu và chỉ ba biến
  STT được thay đổi, không hiển thị secret. Chưa gọi provider thật để kiểm tra
  key hoặc khởi tạo lại adapter với cấu hình mới.

## In progress

- Người dùng tự rebuild API/frontend cho bản sửa ô nhận diện, rồi kiểm tra
  câu ngắn, timestamp corrections, stop và terminal disconnect trên microphone.
- Cần microphone E2E tiếng Việt cho bản sửa phân mảnh mới: câu liên tục, ngập
  ngừng ngắn, hai người nói, pause/resume/stop và kiểm tra sau reload.
- Chưa có kết quả browser/microphone E2E đầy đủ cho upload, playback, AI, export,
  sharing, reconnect và name identification trong toàn bộ UX.

## Next

1. Sửa media download handler: dùng `request` chưa khai báo; kiểm tra local/S3.
2. Browser/microphone E2E Speechmatics VI/EN, noise/known-unknown voices và
   AssemblyAI fallback; đo accuracy/latency, không suy ra từ fixtures.
3. Kiểm thử browser upload → transcript edit/rollback → playback → AI/export,
   ACL, share expiry/revoke và playback URL expiry.
4. Backend pytest/lint, Alembic validation và integration với isolated PostgreSQL.
5. History pagination/count; settings default language/diarization/phone/storage/
   retention metadata cần contract/migration trước khi thêm UI.
6. Public share summary/translation/media hoặc token-based writes cần thiết kế
   ACL riêng. Endpoint hiện tại chỉ đọc metadata/current transcript.
7. Cấu hình deployment public; Render manifest chưa có trong repo.

## Blockers / risks

- `/ready` chỉ kiểm tra database; không khẳng định Redis/worker/provider khỏe.
- Media download bug nêu trên được ghi nhận từ source, chưa sửa trong task docs.
- Signed playback URL có TTL; cần kiểm tra UX khi URL hết hạn.
- Reconnect tạo stream và generic speaker scope mới, không đảm bảo cùng voice
  giữ ID qua nhiều phiên.
- Storage cleanup chạy trước DB cascade, không atomic với object storage.
- Lint/test môi trường local và provider credentials ảnh hưởng verification;
  không coi build/static QA là acceptance browser.
