# Current Status

_Cập nhật lần cuối: 2026-09-30_

## Done

- Rebuild `frontend/` thành React + TypeScript + Vite, thay thế prototype
  bundle bằng source maintainable.
- Đã có typed REST client, auth flow, meeting/upload/transcript UI,
  permission-aware controls, capability gating, WebSocket client và job
  monitoring.
- Đã chạy thành công `npm run check` và `npm run build` trong `frontend/`.
- Đã bổ sung `project_context/` và quy ước handoff/cập nhật tiến độ cho agent.
- Task 12 frontend integration: API client now covers auth recovery, meeting,
  transcript mutation, speakers, comments, jobs and export downloads; the UI
  uses real REST/WebSocket boundaries and has no fake success fallback.
- Đã dựng FastAPI backend foundation: `/api/v1`, health/readiness,
  environment settings, CORS, structured errors/request IDs, JSON logging,
  database/Alembic foundation và provider-neutral contracts.
- Đã implement SQLAlchemy async domain models, PostgreSQL Alembic initial
  migration, và database-focused tests cho ERD v2, bao gồm transcript/summary
  version snapshots và meeting ACL.
- Đã implement authentication slice: email/password, OTP email verification và
  reset password, signed JWT access/refresh, profile endpoint, SMTP boundary và
  Google OAuth authorization-code flow.
- Đã implement TASK 6 Meeting CRUD + ACL: meeting chỉ hiện cho owner hoặc
  collaborator, có permission-aware read/edit/delete, owner-only member/share
  management và token share chỉ lưu hash.
- Đã implement TASK 7 media upload + job system: stream upload có limit,
  ffprobe validation, filesystem storage boundary, media ACL và job persisted
  (`queued/processing/completed/failed`) có progress/error metadata.
- Đã implement TASK 8 realtime STT WebSocket: provider streaming capability
  gate, JWT + meeting ACL, binary audio / pause-resume-stop protocol,
  partial-only delivery, normalized final segment persistence, provider error
  retryability và disconnect lifecycle.
- Đã implement TASK 9 Transcript & Speaker API: immutable snapshot versions,
  current/history/version retrieval, segment edit/split/merge/delete,
  speaker CRUD/reassignment, ACL enforcement and a shared normalized STT
  ingestion boundary used by realtime and future batch/upload workers.
- Đã implement TASK 10 Translation + AI Summary: provider-neutral registries,
  capability discovery, durable async AI jobs, segment-aligned translations,
  structured summaries and immutable summary version regeneration.

## In progress

- Task 12 cannot meet end-to-end completion criteria yet: no real STT,
  translation or LLM adapters are registered, and no batch media processor is
  present. Upload jobs therefore remain queued by design.

## Next

1. Implement/register a real streaming STT adapter and a separate batch media
   processor: worker claim job, normalize bằng FFmpeg, gọi STT provider thật và
   cập nhật transcript/job state through `TranscriptService.append_stt_final`.
2. Register production TranslationProvider/LLMProvider adapters and move the
   in-process AI dispatcher to a separately deployed queue worker for durable
   multi-process execution.
2. Consider replacing WebSocket query-token authentication with a short-lived
   websocket ticket before production deployment.
3. Chạy backend test/lint trên a standard CPython environment and run Alembic
   against an isolated PostgreSQL database before deployment.

## Blockers / risks

- Python hiện có trong workspace là MSYS/UCRT and does not include `pip`; backend
  dependencies and test/lint tooling cannot be installed or run locally.
- Registry hiện chưa bundled adapter; cần chọn/configure STT provider thật
  trước khi có transcript production.
