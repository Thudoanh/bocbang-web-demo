# Backend

FastAPI backend for the Bóc Băng AI modular monolith. Public endpoints are
versioned under `/api/v1`; liveness/readiness, authentication, and the meeting
ownership/ACL slice are currently available. Media processing remains deferred
to a later vertical slice.

## Local development

From `backend/`, create an environment and install the project (including the
test tools), then run:

```powershell
python -m uvicorn app.main:app --reload
pytest
ruff check .
```

The API docs are served at `http://localhost:8000/api/v1/docs`.

`DATABASE_URL` is optional for process startup but required for a ready
deployment and for Alembic migrations. PostgreSQL URLs are normalized to the
`asyncpg` driver. Apply the schema from `backend/` with:

```powershell
alembic upgrade head
```

The initial revision creates the ERD v2 persistence schema, including immutable
transcript and summary version histories. `TEST_DATABASE_URL`, when configured
by a future PostgreSQL integration environment, must point to an isolated test
database; it is never read by the application itself.

STT, translation, and LLM integrations use vendor-neutral contracts in
`app/providers/contracts.py`. Vendor SDKs must remain in adapter modules, never
in domain services. Realtime adapters implement `open_stream(options)` and the
returned `STTStream`; register the adapter factory in `app/providers/stt.py`.
`STT_API_KEY` is available only to that backend factory and is never returned by
the API or sent through WebSocket messages.

## Translation and summaries

`POST /api/v1/meetings/{id}/translations` and `/summaries` validate `edit`
access, the immutable current transcript snapshot, and provider capability,
then return a durable `202` Job. The in-process dispatcher claims the job,
persists only normalized successful output, and records a stable failed state
with retryability otherwise. Translation output is segment-aligned and stored
separately; summary regeneration appends an immutable `SummaryVersion`.

Register deployment adapters in `app/providers/translation.py` and
`app/providers/llm.py`. The dispatcher is intentionally a local worker boundary
for this demo; production should run its `run(job_id)` operation through a
durable external queue/worker.

## Authentication configuration

Email/password authentication requires `DATABASE_URL` and `JWT_SECRET`. Email
verification and password reset only send mail through an explicitly configured
adapter; the built-in production adapter is selected with `EMAIL_PROVIDER=smtp`
and requires `EMAIL_FROM` and `EMAIL_SMTP_HOST` (plus optional SMTP credentials).
The application never logs or persists a plaintext OTP.

Google OAuth uses the standard Google authorization-code flow. Set
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to enable
it. The callback checks a signed, HttpOnly state cookie and redirects to the
configured frontend origin with a URL fragment; the frontend immediately exchanges
the refresh token for its normal session response.

## Meeting ACL

Every meeting endpoint requires a verified bearer token. A meeting is visible
only to its owner or an explicit collaborator. `read`, `comment`, and `edit`
collaborators can read the meeting; `edit` can update meeting metadata; only the
owner can delete a meeting or manage members and share links. A collaborator
must already have an account and can be invited by email or user ID. Share-link
tokens use high-entropy random values, are stored as SHA-256 hashes, and are
returned only by the creation response; deletion revokes rather than exposes or
hard-deletes a link.

## Media upload and jobs

`POST /meetings/{id}/media` streams a multipart file to temporary storage,
enforces `MAX_UPLOAD_BYTES`, validates its readable duration with the `ffprobe`
binary, and stores valid media through a filesystem storage adapter. Configure
`MEDIA_STORAGE_PATH` for local development. Production should provide an
S3-compatible adapter behind the same `MediaStorage` boundary.

The endpoint creates a persisted `media_processing` job in `queued` state;
`GET /api/v1/jobs/{id}` exposes its live persisted status, progress, and error.
No worker or STT provider is implemented in this slice, so jobs intentionally
remain queued until a later processor claims them. Ensure `ffprobe` is on the
service PATH before enabling uploads.

## Realtime transcription

`WS /api/v1/realtime/{meeting_id}?access_token=<access JWT>` requires `edit`
access and a configured STT provider whose `streaming` capability is true. The
client sends binary audio chunks and optional JSON commands
`recording.pause`, `recording.resume`, and `recording.stop`. It receives
`session.ready`, `transcript.partial`, `transcript.final`, `meeting.status`, or
`error` events. `error` includes a stable code and `retryable` boolean.

Only normalized `transcript.final` results create `TranscriptVersion` and
`SegmentVersion` rows; partial results are socket-only. Stopping or disconnecting
changes an active meeting to `processing`, not `completed`; a non-retryable STT
provider error changes it to `failed`. Realtime sessions do not fabricate or
complete upload jobs.

## Production provider adapters

Set `STT_PROVIDER=assemblyai` and `STT_API_KEY` to enable AssemblyAI batch and
realtime STT. The media worker normalizes uploads to mono PCM WAV at 16 kHz
using `ffmpeg`, stores the normalized object, and persists normalized STT
segments and speaker labels. The browser sends 16 kHz mono PCM16 over the API
WebSocket; the AssemblyAI credential always stays on the server. `ffmpeg` and
`ffprobe` must both be present on PATH.

Set `TRANSLATION_PROVIDER=gemini` with `TRANSLATION_API_KEY` (or `LLM_API_KEY`)
for segment-aligned VI ↔ EN translations. Set `LLM_PROVIDER=gemini` with
`LLM_API_KEY` for structured `general`, `briefing`, and `voting` summaries.
`GEMINI_MODEL` defaults to `gemini-2.5-flash`; `LLM_MODEL` overrides it for
summary generation. Provider keys are backend-only values.
`ASSEMBLYAI_API_BASE_URL`, `ASSEMBLYAI_STREAMING_BASE_URL`, and
`GEMINI_API_BASE_URL` default to their official endpoints and may be overridden
for a regional endpoint, proxy, or integration test.
