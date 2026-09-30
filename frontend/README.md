# Bóc Băng AI frontend

React + TypeScript + Vite frontend replacing the legacy prototype. It calls the
FastAPI contract only; provider credentials and AI logic stay server-side.

## Start

```bash
copy .env.example .env
npm install
npm run dev
```

`VITE_API_BASE_URL` and `VITE_WS_BASE_URL` point to the API and realtime
gateway. Do not place secrets in `.env` because Vite exposes `VITE_*` values
to the browser.

## Structure

- `src/api` — central typed HTTP endpoints and auth-aware client
- `src/auth` — token lifecycle and login / OTP / Google handoff
- `src/realtime` — reconnecting meeting WebSocket client
- `src/pages` — thin route-level feature composition
- `src/components` — reusable application shell and UI states
- `src/types` / `src/utils` — API domain contracts and permission checks

The UI has real loading, empty, error, and permission-gated states. Feature
actions create jobs through the API; the UI does not simulate STT, translation,
or summaries.
