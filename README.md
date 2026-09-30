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
