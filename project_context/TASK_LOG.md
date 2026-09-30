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
