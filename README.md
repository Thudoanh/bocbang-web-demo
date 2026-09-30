# Bóc Băng AI

Repository này tách biệt prototype hiện có với nền tảng production dự kiến.

## Repository structure

- `frontend/` — Production frontend mới.
- `backend/` — FastAPI backend.
- `prototype/` — Legacy HTML/CSS/JS prototype dùng làm UI reference.
- `docs/` — Architecture, API, planning và deployment documentation.
- `agent/` — Context/instructions dành cho coding agents.
- `scripts/` — Development/setup utilities.
- `docker/` — Container/deployment-related configuration.

## Documentation

- [Frontend rebuild plan](docs/planning/frontend-rebuild.md)
- [System architecture](docs/architecture/architecture.md)
- [Provider architecture](docs/architecture/provider-architecture.md)
- [ERD](docs/architecture/erd.md)
- [API specification](docs/architecture/api-spec.md)
- [Deployment design](docs/deployment/deployment.md)
- [Implementation plan](docs/planning/implementation-plan.md)

See [agent guidance](agent/README_AGENT.md) before making implementation changes.

## Running locally

### Prerequisites

- Python 3.11 or newer (a standard CPython installation with `pip`)
- Node.js with npm
- PostgreSQL reachable from the machine
- `ffprobe` on `PATH` to accept media uploads

Docker and a separate worker are not currently required or supplied by this
repository. The API's local AI dispatcher runs in the FastAPI process.

### Configure the environment

From the repository root, create `.env` from [`.env.example`](.env.example).
Set `DATABASE_URL` to a PostgreSQL database and set a long random `JWT_SECRET`.
`FRONTEND_ORIGIN` defaults to Vite's `http://localhost:5173`; keep it aligned
with the frontend URL for CORS and Google OAuth redirects. `MEDIA_STORAGE_PATH`
is a local filesystem directory for uploaded media.

The `VITE_*` values are public browser configuration. Do not put provider keys,
database URLs, JWT secrets, SMTP credentials, or OAuth client secrets in them.
The frontend also has its own [environment example](frontend/.env.example).

Google sign-in needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_REDIRECT_URI`. Email OTP and password reset need an email provider
configuration. Leave provider variables unset when those integrations are not
available; their server-side features report an unavailable/failed state rather
than returning fabricated results.

### Start the application

Open three terminals from a fresh clone:

```powershell
# Terminal 1 — install backend packages and apply the database schema
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
alembic upgrade head
python -m uvicorn app.main:app --reload
```

```powershell
# Terminal 2 — install and run the frontend
cd frontend
copy .env.example .env
npm install
npm run dev
```

The frontend is at `http://localhost:5173`, the API documentation is at
`http://localhost:8000/api/v1/docs`, and health endpoints are exposed under
`/api/v1/health`.

### Local smoke test

1. Register, verify the OTP delivered by the configured email provider, then log in.
2. Create a meeting and upload a valid file; `ffprobe` must be installed.
3. View and edit a persisted transcript, rename speakers, add comments, run an
   export and download it once its job completes.
4. If a streaming STT adapter is configured, create a realtime meeting, grant
   microphone access, start recording, confirm partial text, then stop and
   confirm final persisted segments.

The repository deliberately contains no registered real STT, translation, or
LLM adapter, and no batch-media processor. Consequently uploads remain queued,
and provider-dependent transcription, translation, summaries, and realtime
recording cannot complete until backend-only adapters/processing are supplied.
This is a backend capability limitation, not a frontend fallback. If the
frontend cannot reach the API, first verify `VITE_API_BASE_URL`,
`VITE_WS_BASE_URL`, `FRONTEND_ORIGIN`, PostgreSQL connectivity, migrations, and
that the API process is running. A queued media job means no batch processor is
available; a rejected upload usually means `ffprobe` is absent or the file
violates configured limits.
