# Task Log

Mục mới nhất được thêm ở đầu file. Dùng format ngắn dưới đây:

```md
## YYYY-MM-DD — Tên task

- Status: done | blocked
- Scope: ...
- Changed: `path/file`, ...
- Verified: ...
- Follow-up / blocker: ...
```

## 2026-10-12 — Sửa ô transcript bị kẹt ở trạng thái nhận diện

- Status: done (new Docker rebuild/microphone verification pending)
- Scope: Giải quyết partial còn sót khi final sửa timestamp/text; giữ partial
  mới hơn, dùng SDK utterance/end-of-turn để xác định snapshot đã kết thúc.
  Final theo turn ID thay preview; bản nháp còn lại lúc dừng/lỗi giữ chữ với
  nhãn chưa xác nhận/chưa lưu, không được biến thành transcript đã lưu.
- Changed: Speechmatics adapter/tests, WebSocket integration test, frontend
  live transcript reducer/tests và MeetingPage recording lifecycle; docs/context.
- Verified: 67 focused backend tests, 14 frontend tests, TypeScript/Vite build,
  scoped Ruff và diff check pass. Các provider được mô phỏng; WebSocket/SQLite
  xác nhận final timing ngắn hơn preview vẫn lưu đúng một segment.
- Follow-up / blocker: Bản sửa phân mảnh trước đã rebuild API/frontend và kiểm
  tra health/capabilities thành công. Người dùng báo chạy ổn nhưng còn preview
  nhận diện. Bản sửa mới chưa rebuild Docker theo ưu tiên người dùng tự chạy;
  cần thử microphone và stop/reload sau rebuild. Không commit/push hoặc sửa key.

## 2026-10-12 — Sửa phân mảnh transcript realtime Speechmatics

- Status: done (microphone/provider acceptance pending)
- Scope: Giữ một ô tích lũy cho các fragment cùng lượt nói; hoãn chốt final
  khi còn partial chưa xác nhận; giữ ranh giới speaker/language/audio gap.
- Changed: `backend/app/providers/speechmatics.py`, Speechmatics/realtime tests,
  `frontend/src/realtime/liveTranscript.ts`, reducer tests, provider/API/validation
  docs và project context. Không sửa `.env`, migrations hoặc transcript cũ.
- Verified: 61 focused backend tests và 10 frontend tests pass; TypeScript/Vite
  build pass; Ruff adapter/provider tests và F/I realtime tests pass; diff check.
  WebSocket integration xác nhận ba fragment được lưu thành một SQLite segment.
  Test dependencies cài vào `.venv-stt`/`node_modules` Git ignored. Async tests
  chạy ngoài sandbox Windows; không gọi provider thật.
- Follow-up / blocker: Docker Engine chưa chạy nên chưa restart runtime hoặc
  kiểm thử browser/microphone. Rebuild API/frontend rồi thử tiếng Việt liên tục,
  ngập ngừng, đổi speaker, pause/resume/stop, reconnect và reload transcript.

## 2026-10-08 — Cập nhật Speechmatics trong .env dự án

- Status: done
- Scope: Áp dụng cấu hình Speechmatics từ env tham chiếu đã đối chiếu.
- Changed: `.env` (Git ignored), `project_context/CURRENT_STATUS.md`, `project_context/TASK_LOG.md`.
- Verified: Chỉ đổi `SPEECHMATICS_API_KEY`, `STT_PROVIDER` và
  `STT_FALLBACK_PROVIDER`; key khớp tham chiếu, các cấu hình khác giữ nguyên.
  Không in credentials, không sửa file tham chiếu, không gọi provider thật.
- Follow-up / blocker: Recreate/restart runtime để áp dụng; Speechmatics key
  cần provider smoke test sau khi áp dụng.

## 2026-10-08 — Đối chiếu và cập nhật .env local

- Status: done
- Scope: Đồng bộ cấu hình local với Settings và env example mà không đổi
  credentials, URLs hoặc model/provider lựa chọn đã có.
- Changed: `.env` (Git ignored), `project_context/CURRENT_STATUS.md`, `project_context/TASK_LOG.md`.
- Verified: Thêm 17 biến còn thiếu; đổi bốn S3 aliases sang tên canonical, kiểm
  tra giá trị có sẵn được giữ nguyên và không trùng key. Python virtualenv
  validate Settings/queue và khởi tạo provider/email adapters thành công.
  Không in secret, không gọi API ngoài hay kiểm tra kết nối DB/Redis.
- Follow-up / blocker: Giữ AssemblyAI primary; muốn Speechmatics cần điền key
  và đổi provider. Cấu hình được áp dụng ở lần restart/recreate process tiếp theo;
  chưa restart stack trong task này.

## 2026-10-08 — Rút gọn README hướng dẫn chạy local

- Status: done
- Scope: Viết lại README bằng tiếng Việt, ưu tiên Docker Compose với ba bước
  tạo cấu hình, khởi động và đăng ký/sử dụng; hướng dẫn khi chưa có AI key.
- Changed: `README.md`, `project_context/CURRENT_STATUS.md`, `project_context/TASK_LOG.md`.
- Verified: Liên kết và code fences; đối chiếu lệnh với Compose, provider/email
  factory; kiểm tra diff. Không chạy ứng dụng, không sửa runtime hoặc `.env`.
- Follow-up / blocker: Không có blocker cho task tài liệu; các việc E2E/bug
  đã ghi nhận trước vẫn giữ nguyên.

## 2026-10-08 — Đồng bộ tài liệu theo codebase hiện tại

- Status: done
- Scope: Đối chiếu source để cập nhật setup/config, feature scope, architecture,
  provider, API, ERD, migrations, deployment, planning và project handoff.
- Changed: root/backend/frontend/prototype README, `agent/README_AGENT.md`,
  `.env.example`, `docs/architecture/*`, `docs/deployment/*`, `docs/planning/*`,
  chú thích lịch sử audit/UI specs, `project_context/CURRENT_STATUS.md`,
  `project_context/DECISIONS.md`. Gemini model trong env mẫu đồng bộ default
  Settings (`gemini-2.5-flash`); không sửa `.env` hiện có hay runtime code.
- Verified: Markdown local links/code fences; toàn bộ REST route inventory từ
  AST của backend đối chiếu API spec; diff whitespace theo CRLF của repo.
  Không chạy lại application tests, provider requests hoặc browser E2E.
- Follow-up / blocker: Media download handler dùng `request` chưa khai báo;
  ghi nhận trong docs/backlog. Browser E2E và public deployment vẫn cần xác minh.

## 2026-10-08 — Speechmatics realtime, batch và known-speaker identification

- Status: done
- Scope: Dùng Speechmatics làm STT chính cho realtime và file upload, đăng ký tối
  đa ba voiceprint cho mỗi profile, nhận diện người nói theo tên và giữ AssemblyAI
  làm fallback không nhận diện tên.
- Changed: provider contracts/factory, Speechmatics batch/voice adapters, fallback,
  migration `20261008_0012`, voice-profile service/API, realtime persistence,
  media worker, Settings/Meeting enrollment UI, capability/session metadata và tests.
- Verified: 93 backend tests passed; frontend TypeScript/build passed trong Docker;
  migration container exited 0 tại revision `20261008_0012`; API/frontend healthy;
  capability báo Speechmatics batch/realtime/speaker identification; smoke test thật
  nhận Huy và Minh ở cả batch (9/8 turns) lẫn realtime (57/39 emitted segments).
- Follow-up / blocker: Chạy thêm browser/microphone E2E. Speechmatics Voice SDK có
  timeout khởi tạo cố định 5 giây; một cold start đã timeout và lần kết nối sau thành
  công, nên fallback/reconnect UI cần được theo dõi trong môi trường thật.

## 2026-10-08 — Pre-meeting Voice Profile Enrollment & Automatic Speaker Recognition

- Status: done
- Scope: Tự động nhận diện và gán tên người phát biểu trong cuộc họp dựa trên mẫu giọng
  được thu âm trước (10-25s) hoặc tải lên file âm thanh mẫu (WAV/MP3/M4A). Hỗ trợ cả
  mẫu giọng cá nhân của người dùng và mẫu giọng khách theo từng cuộc họp. Tích hợp so khớp
  voiceprint cosine similarity vào cả streaming realtime STT WebSocket và batch media upload processing.
- Changed:
  - Database & Models: `backend/app/models/voice_profile.py`, `transcript.py`, `meeting.py`, `user.py`,
    `backend/alembic/versions/20261008_0011_voice_profiles.py`.
  - Acoustic Engine: `backend/app/services/voice_embedding.py` (192-dim Log-Mel filterbanks + MFCCs + deltas + statistical pooling).
  - Business Services & APIs: `backend/app/services/voice_profiles.py`, `transcripts.py`, `realtime.py`,
    `media_worker.py`, `backend/app/api/v1/routes/voice_profiles.py`, `realtime.py`, `router.py`.
  - Frontend: `frontend/src/types/domain.ts`, `frontend/src/api/endpoints.ts`,
    `frontend/src/components/VoiceEnrollmentModal.tsx`, `frontend/src/pages/MeetingPage.tsx`,
    `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/SpeakersPage.tsx`.
  - Tests: `backend/tests/test_migrations.py`, `backend/tests/test_voice_profiles.py`.
- Verified:
  - Python bytecode compilation (`compileall`) qua 100% không có lỗi.
  - Test acoustic embedding và vector cosine similarity: 1.0 với cùng giọng nói, 0.51 với giọng khác tần số, so khớp ứng viên chính xác `conf=1.0`.
  - Alembic migration test assertions bổ sung cho `voice_profiles` và `speakers.voice_profile_id`.
- Follow-up / blocker:
  - Chạy Docker Compose rebuild stack để nạp code mới nhất lên container.
  - Thử nghiệm trên micro thực tế với 2 hoặc nhiều người nói khác nhau trong phiên họp trực tiếp.

## 2026-10-07 — Realtime speaker diarization and corrections

- Status: done (automated verification; real audio/browser acceptance pending)
- Scope: Enable/disable AssemblyAI streaming speaker labels, retain dominant
  turn labels, consume mid-session/end-of-session corrections, and display
  persisted speakers in realtime. Scope provider labels by connection to avoid
  merging unrelated voices after reconnect. Each session starts a new STT
  snapshot with existing projection and continuing meeting timestamps.
- Changed: `backend/app/providers/assemblyai.py`, `contracts.py`,
  `backend/app/services/realtime.py`, `transcripts.py`, realtime WebSocket route,
  frontend `MeetingPage.tsx` / `meetingSocket.ts`, provider tests and new
  `backend/tests/test_realtime_speakers.py`, API/provider docs and README.
- Verified: 83 backend tests passed, including 17 added cases covering labels,
  disabled diarization, duplicate final/correction handling, unsupported
  capability, reconnect isolation, historical snapshots, and manual/structural
  edits. Frontend production build passed. Focused lint passed with pre-existing
  E501/UP037 excluded from legacy files; realtime service/route and new tests
  pass full lint. No schema changes or migration needed.
- Follow-up / blocker: No supplied two-person audio fixture or browser runtime
  was available for real microphone/provider accuracy verification. Rebuild
  Docker services to use the new source, then follow the README smoke test.
  Speaker labels represent the dominant voice per turn; overlapping or
  within-turn speaker changes are not split into separate segments.

## 2026-10-07 — Export edited transcript revisions

- Status: done (browser acceptance pending)
- Scope: Export the pinned immutable transcript version by replaying edits over
  its nearest checkpoint; retain legacy snapshot compatibility and terminal
  failures for empty or unavailable history. History/rollback use the same reader.
- Changed: `backend/app/services/transcript_versions.py`, `transcripts.py`,
  `exports.py`, `backend/tests/test_export_versions.py`,
  `backend/tests/test_exports_collaboration.py`, project context documentation.
- Verified: all 66 backend tests passed, including six formats after edits,
  queued-version isolation, split/merge/delete/speaker assignment, checkpoint,
  rollback, legacy snapshots and invalid input. Focused Ruff checks passed;
  existing E501 violations in `transcripts.py` were excluded. Restarted the local
  worker only after verifying no executing jobs or Redis messages; created six
  new exports for the previously failing revision through real Redis/Dramatiq,
  verified completed state, stored downloads and content. API readiness passed.
- Follow-up / blocker: Browser tools are unavailable in this session; verify UI
  interaction separately. Export UI error details/completion effect issues remain
  outside this backend fix. Existing historical failed/pending jobs were preserved;
  no migrations or provider calls were required.

## 2026-10-07 — Transient realtime translation

- Status: done (live microphone/provider acceptance pending)
- Scope: Added an opt-in VI ↔ EN translation view for finalized realtime STT
  segments while preserving the existing saved translation workflow.
- Changed: realtime WebSocket commands/events and background translation queue,
  trusted segment backfill, meeting recording UI/socket state, protocol docs.
- Verified: frontend TypeScript/Vite production Docker build; seven focused
  realtime WebSocket tests covering final-only translation, toggle/backfill,
  deduplication, unsupported pairs, invalid segment IDs and provider failures.
- Follow-up / blocker: Run a paid browser microphone session with the configured
  STT and translation providers to measure end-to-end latency and translation
  quality for both VI → EN and EN → VI.

## 2026-10-07 — Vietnamese realtime STT steering and audio capture

- Status: done (live provider accuracy smoke test pending)
- Scope: Pinned realtime STT to the meeting language, upgraded the default
  AssemblyAI realtime model to Universal 3.6 balanced mode, and replaced the
  browser's nearest-sample ScriptProcessor capture with an AudioWorklet PCM16
  pipeline.
- Changed: `backend/app/providers/assemblyai.py`, backend settings/tests,
  `frontend/src/realtime/*`, `frontend/src/pages/MeetingPage.tsx`, environment
  examples and provider/runtime documentation.
- Verified: frontend TypeScript/Vite Docker build; 18 focused
  provider/realtime tests; API and frontend health checks; runtime settings
  report `universal-3-6-pro` / `balanced`; full backend suite reports 50 passed
  and one unrelated existing export test failure because its test app has no
  Redis enqueue configuration.
- Follow-up / blocker: Run a real Vietnamese microphone session to assess
  provider accuracy. Repository-wide Ruff remains red on pre-existing style
  debt and is not a clean quality gate for this task.

## 2026-10-06 — Frontend added to Docker Compose

- Status: done
- Scope: Added a frontend service on localhost:5173, built using locked npm
  dependencies in Node and served by Nginx. SPA fallback supports direct links
  and OAuth callbacks; frontend waits for API readiness. Only public Vite build
  arguments are passed; env files and host dependencies are excluded.
- Changed: `compose.yaml`, `docker/frontend.Dockerfile`, `frontend/.dockerignore`,
  `frontend/nginx.conf`, `README.md`, deployment docs and current status.
- Verified: Frontend Compose assertions (port, readiness dependency, public args,
  no backend environment, Dockerfile path); `docker compose build frontend`
  including TypeScript/Vite build; temporary container Nginx syntax, HTTP root,
  SPA/deep-link/callback fallback, CSS/JS assets and missing asset 404 checks;
  scoped `git diff --check`.
- Follow-up / blocker: Full backend/provider end-to-end testing remains pending.
  Rebuild after changing frontend source or public configuration. Docker Engine
  was reachable with elevated access for the image build and container checks.

## 2026-10-06 — Local Docker Compose backend and worker

- Status: done (Compose validated; container runtime verification pending)
- Scope: Added PostgreSQL, Redis, migration, API, worker and reconciler services
  with health/migration startup gates and persistent shared local media storage.
  Backend image runs as an unprivileged user and includes FFmpeg/ffprobe and
  DejaVu fonts for Vietnamese PDF exports.
- Changed: `compose.yaml`, `docker/backend.Dockerfile`, `backend/.dockerignore`,
  `README.md`, `docs/deployment/deployment.md`, project context.
- Verified: `docker compose config --quiet`; parsed Compose configuration
  assertions for services, migration/health gates, container URLs, shared volume,
  localhost-only API publishing and Dockerfile path; missing `JWT_SECRET`
  rejection; scoped `git diff --check`.
- Follow-up / blocker: Docker CLI is available but Docker Engine is not running.
  Build/start with `docker compose up --build -d` and smoke-test migrations,
  readiness, real job processing and persistence once Docker Desktop is running.

## 2026-10-05 — Queue delivery reconciliation

- Status: done (static verification; runtime dependencies unavailable locally)
- Scope: Added at-least-once recovery for jobs committed before a Redis publish failure or process crash, while preserving retry backoff.
- Changed: `backend/app/workers/reconciler.py`, job lifecycle/model/migration, queue settings, deployment and runbook documentation.
- Verified: Python syntax compilation and diff whitespace checks; pytest/Ruff require project dependencies unavailable in this environment.
- Follow-up / blocker: Deploy the reconciler as a separate process with the API/worker database and Redis configuration; execute migration `20261005_0009` before enabling it.

## 2026-10-05 — Durable Redis/Dramatiq worker architecture

- Status: done (static verification; runtime dependencies unavailable locally)
- Scope: Replaced API-process media/STT, translation, summary, and export dispatch with Redis-backed Dramatiq job delivery and a standalone worker.
- Changed: `backend/app/workers/*`, job lifecycle model/migration, API enqueue routes, runners, queue config/dependency/docs.
- Verified: Python compile and diff whitespace checks; pytest/Ruff remain unavailable in bundled Python.
- Follow-up / blocker: Run migrations and worker/API integration against managed Redis, PostgreSQL, object storage, FFmpeg, and configured providers.

## 2026-10-05 — S3-compatible durable media storage

- Status: done
- Scope: Added local/S3 storage backends, private signed downloads, object-key-only media/export persistence, and worker temporary-file compatibility.
- Changed: `backend/app/providers/storage.py`, storage wiring/config, media/export/worker/provider flows, storage tests, environment and deployment docs.
- Verified: `python -m compileall -q app tests alembic` and `git diff --check` passed; pytest/Ruff are unavailable in the bundled Python environment.
- Follow-up / blocker: Real S3/R2/MinIO and pytest verification require deployment credentials and a standard Python environment with dependencies installed.

## 2026-10-02 — UI/UX Audit Phase 2: UX & Control Flow Polish

- Status: done
- Scope: Implemented Phase 2 of UI/UX audit remediation plan including tabbed side panel organization for meeting detail, confirmation dialogs for split/merge, mm:ss segment timestamp formatting, and expanded Vietnamese section label mapping for AI summaries.
- Changed: `frontend/src/pages/MeetingPage.tsx`, `frontend/src/pages/SummaryPage.tsx`, `frontend/src/utils/time.ts`, project context docs.
- Verified: `npm.cmd run build` passed in `frontend/`.
- Follow-up / blocker: End-to-end browser QA with backend media stream playback.

## 2026-10-02 — Groq translation fallback

- Status: done
- Scope: Extended the Groq adapter and backend configuration so Groq can
  translate segment-aligned VI ↔ EN output as a primary or fallback provider.
- Changed: `backend/app/providers/groq.py`, translation registry/config,
  adapter tests, `.env` examples and provider docs.
- Verified: static Python compilation and diff whitespace checks.
- Follow-up / blocker: Provider-backed E2E requires configured credentials and
  a standard Python environment with pytest/project dependencies.

## 2026-10-02 — Groq fallback for Gemini summaries

- Status: done
- Scope: Added a Groq structured-summary provider and opt-in fallback when the
  configured primary LLM provider fails.
- Changed: `backend/app/providers/groq.py`, `backend/app/providers/llm.py`,
  LLM configuration, adapter tests, deployment examples and provider docs.
- Verified: `python -m compileall -q backend/app backend/tests` passed;
  `pytest` could not run because the bundled Python lacks pytest/project deps.
- Follow-up / blocker: A real provider-backed E2E run still needs deployment
  credentials and a standard Python environment; Groq is only used when
  `LLM_FALLBACK_PROVIDER=groq` is set.

## 2026-10-01 — Frontend BA Phase 4: Polish and QA Record

- Status: done
- Scope: Shared SVG icon polish for app/auth chrome, responsive/static BA
  reference checklist and acceptance verification record.
- Changed: `frontend/src/components/ui.tsx`, `frontend/src/components/AppShell.tsx`,
  `frontend/src/pages/AuthPage.tsx`, `frontend/src/app/styles.css`,
  `docs/planning/phase-4-qa.md`, project context.
- Verified: `npm.cmd run build` passed in `frontend/`; targeted backend
  `python -m compileall` passed.
- Follow-up / blocker: Browser automation and provider-backed E2E were not
  available in this environment; playback and public shared content still need
  backend token-scoped stream/read contracts.

## 2026-10-01 — Frontend BA Phase 3: History, Data, Profile

- Status: done
- Scope: Server-side meeting search/filter, owner-only media/meeting deletion
  confirmation, and editable user full-name profile.
- Changed: `backend/app/api/v1/routes/auth.py`, `backend/app/api/v1/routes/meetings.py`,
  `backend/app/schemas/auth.py`, `backend/app/services/auth.py`,
  `backend/app/services/meetings.py`, `frontend/src/api/*`,
  `frontend/src/auth/AuthContext.tsx`, `frontend/src/pages/HistoryPage.tsx`,
  `frontend/src/pages/SettingsPage.tsx`, styles and project context.
- Verified: frontend `npm.cmd run build`; backend targeted `python -m compileall`.
- Follow-up / blocker: Profile defaults/phone/storage metadata and History
  total-count pagination need explicit persisted API contracts; E2E requires
  configured providers and isolated database.

## 2026-10-01 — Frontend BA Phase 0–2

- Status: done
- Scope: BA/API gap audit, realtime/upload flow, transcript editing controls,
  speaker management, translation, summary/minutes, authenticated export and
  share-link UI using real API contracts.
- Changed: `docs/planning/phase-0-api-gap.md`, `frontend/src/api/*`,
  `frontend/src/app/*`, `frontend/src/components/AppShell.tsx`,
  `frontend/src/pages/*`, `frontend/src/types/domain.ts`, project context.
- Verified: `npm.cmd run build` passed in `frontend/` after Phase 2.
- Follow-up / blocker: Public share API supplies metadata only; audio playback
  endpoint and real provider/browser E2E validation remain outstanding.

## 2026-09-30 — Frontend ↔ Backend Integration

- Status: blocked
- Scope: Completed REST/WebSocket UI integration and real async/error states;
  added recovery auth, transcript mutations, speaker/comment controls, export
  job/download handling, capability-gated browser recording and local-run docs.
- Changed: `frontend/src/api/*`, `frontend/src/auth/AuthContext.tsx`,
  `frontend/src/pages/AuthPage.tsx`, `frontend/src/pages/MeetingPage.tsx`,
  `frontend/src/types/domain.ts`, `README.md`, project context.
- Verified: `npm.cmd run check` and `npm.cmd run build` pass in `frontend/`.
- Follow-up / blocker: Batch upload STT worker and real STT/translation/LLM
  adapters must be registered server-side before Task 12 can be marked complete.

## 2026-09-30 — Translation + AI Summary

- Status: done
- Scope: Provider-neutral translation/LLM registries, capabilities, durable AI
  job processing, separate segment-aligned translations, structured summaries
  and immutable summary regeneration/version APIs.
- Changed: AI services/routes/schemas, provider registries/contracts, job
  payload migration, application wiring, AI tests and API/provider/context docs.
- Verified: `python -m compileall -q app tests alembic` passed. Focused tests
  use fake translation/LLM providers; pytest/Ruff remain unavailable in the
  bundled MSYS Python because project packages are not installed.
- Follow-up / blocker: No real provider adapter is registered, and the current
  dispatcher is in-process; production needs an external queue worker.

## 2026-09-30 — Transcript & Speaker Management

- Status: done
- Scope: Current/versioned transcript retrieval, immutable full-snapshot edits,
  split/merge/delete/timestamp and speaker reassignment, meeting speakers and
  ACL-protected REST endpoints.
- Changed: `backend/app/services/transcripts.py`, transcript schemas/routes,
  router/realtime integration, transcript API tests and API/progress docs.
- Verified: `python -m compileall -q app tests alembic` passed. Added focused
  API tests; pytest/Ruff remain unavailable in the bundled MSYS Python because
  project packages are not installed.
- Follow-up / blocker: Batch upload STT worker is still not implemented from
  Task 7; it must call the shared `TranscriptService.append_stt_final` boundary.

## 2026-09-30 — Realtime STT / WebSocket

- Status: done
- Scope: Authenticated, ACL-protected realtime WebSocket with binary audio,
  pause/resume/stop, streaming capability detection, retryable provider errors,
  final-only persistence and disconnect cleanup.
- Changed: `backend/app/api/v1/routes/realtime.py`, realtime transcript service,
  STT streaming contracts/registry, capability route, application wiring,
  `frontend/src/realtime/meetingSocket.ts`, realtime tests and
  API/provider/backend documentation.
- Verified: `python -m compileall -q app tests alembic`, frontend `npm run
  check`, and frontend `npm run build` passed. Backend `pytest`/Ruff are
  unavailable because the available MSYS Python has no project packages; the
  alternate `C:\python.exe` fails to start due to a missing runtime DLL.
- Follow-up / blocker: Register a real backend-only streaming adapter, run
  `pytest`, `ruff check .`, migration validation, and a local browser/STT
  integration test in a standard CPython environment.

## 2026-09-30 — Media Upload + Job System

- Status: done
- Scope: Multipart media upload, size/extension/ffprobe validation, local
  storage boundary, media CRUD authorization, durable job status API and job
  metadata migration.
- Changed: `backend/app/services/media.py`, media routes/schemas/storage
  adapter, `Job` model and Alembic revision `20260930_0003`, settings,
  dependency metadata, tests and API/backend documentation.
- Verified: `python -m compileall -q app tests alembic` passed. Added media API
  tests for queued-job creation, ACL, deletion and rejected files; pytest cannot
  run in the available MSYS/UCRT Python because project dependencies are absent.
- Follow-up / blocker: Install dependencies (including `python-multipart`),
  install FFmpeg/ffprobe, run migration/tests, then implement the worker that
  moves persisted media-processing jobs beyond `queued`.

## 2026-09-30 — Meeting CRUD + ACL

- Status: done
- Scope: Authenticated meeting create/list/read/update/delete, centralized
  owner/collaborator authorization, collaborator lifecycle and owner-managed
  share links.
- Changed: `backend/app/api/v1/routes/meetings.py`, authentication dependency,
  `backend/app/services/meetings.py`, meeting schemas/model, router, tests and
  backend/API documentation.
- Verified: `python -m compileall -q app tests alembic` passed. Added API tests
  for CRUD, ACL hierarchy and share-token handling; pytest could not run because
  the available MSYS/UCRT Python has no installed FastAPI/SQLAlchemy/pytest.
- Follow-up / blocker: Run `pytest` and `ruff check .` with standard CPython,
  then run the migration/test suite against isolated PostgreSQL.

## 2026-09-30 — Authentication & User Management

- Status: done
- Scope: Email/password registration and verification, password reset, signed
  JWT sessions, authenticated profile endpoint, SMTP delivery boundary and Google
  OAuth authorization-code flow.
- Changed: `backend/app/api/v1/routes/auth.py`, `backend/app/services/auth.py`,
  `backend/app/core/security.py`, `backend/app/providers/email.py`,
  `backend/app/schemas/auth.py`, `backend/alembic/versions/20260930_0002_google_subject_unique.py`,
  settings/dependencies/tests, frontend auth callback handling and related docs.
- Verified: `python -m compileall -q app tests alembic`; `npm.cmd run check`;
  `npm.cmd run build` passed. Backend pytest/Ruff and real PostgreSQL validation
  remain blocked by the local MSYS/UCRT Python without pip/project dependencies.
- Follow-up / blocker: Configure PostgreSQL, `JWT_SECRET`, a real email delivery
  adapter and Google OAuth credentials before using the auth endpoints in deploy.

## 2026-09-30 — Database Models + Migrations

- Status: done
- Scope: Async SQLAlchemy persistence models, PostgreSQL initial schema and
  database-focused test coverage for the ERD v2 domain.
- Changed: `backend/app/models/*`, `backend/app/db/base.py`,
  `backend/alembic/*`, `backend/tests/test_models.py`,
  `backend/tests/test_migrations.py`, `backend/pyproject.toml`,
  `backend/README.md`, `docs/architecture/erd.md`.
- Verified: `python -m compileall -q app tests alembic` passed. Runtime test,
  lint and PostgreSQL migration validation remain blocked because the available
  MSYS/UCRT Python has no `pip` or project dependencies.
- Follow-up / blocker: Use standard CPython, install `.[dev]`, then run `pytest`,
  `ruff check .`, and `alembic upgrade head` / `downgrade base` against isolated PostgreSQL.

## 2026-09-30 — Backend Foundation FastAPI

- Status: done
- Scope: FastAPI modular-monolith foundation, API v1 system checks, configuration,
  structured errors/logging, database/Alembic and provider contracts.
- Changed: `backend/app/*`, `backend/alembic/*`, `backend/pyproject.toml`,
  `backend/tests/test_application.py`, `.env.example`, `backend/README.md`.
- Verified: `python -m compileall -q app tests alembic` passed. Test/lint install
  was attempted but MSYS/UCRT Python lacks compatible native Pydantic/Ruff wheels
  and Rust is unavailable.
- Follow-up / blocker: Run `pytest` and `ruff check .` under a standard CPython
  environment before deployment; resolve documented frontend/API schema gaps.

## 2026-09-30 — Thiết lập project context cho agents

- Status: done
- Scope: Tạo điểm handoff và quy tắc cập nhật tiến độ sau từng task.
- Changed: `project_context/*`, `agent/README_AGENT.md`.
- Verified: Đã kiểm tra cấu trúc và liên kết tài liệu trong repo.
- Follow-up / blocker: Agents phải tuân thủ quy ước này ở các task tiếp theo.

## 2026-09-30 — Rebuild frontend React + TypeScript

- Status: done
- Scope: Scaffold và implement frontend production dựa trên prototype/API v2.
- Changed: `frontend/*`.
- Verified: `npm run check`; `npm run build`.
- Follow-up / blocker: Chờ FastAPI backend để chạy end-to-end.
