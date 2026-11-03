"""ASGI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import API_V1_PREFIX, Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware
from app.db.session import Database
from app.providers.email import build_email_sender
from app.providers.llm import build_llm_provider
from app.providers.stt import build_speaker_enrollment_provider, build_stt_provider
from app.providers.storage import build_storage_backend
from app.providers.translation import build_translation_provider
from app.workers.broker import enqueue_job

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create an application instance with explicit, testable dependencies."""
    resolved_settings = settings or get_settings()
    if resolved_settings.environment.lower() in {"production", "prod"}:
        # A web service that accepts jobs without a broker would durably create
        # work it cannot deliver, so fail during production construction.
        resolved_settings.require_queue_configuration()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(resolved_settings.log_level)
        app.state.database = Database(
            resolved_settings.database_url,
            query_timing_enabled=resolved_settings.performance_query_timing_enabled,
            slow_query_ms=resolved_settings.performance_slow_query_ms,
        )
        if app.state.database.is_configured:
            import asyncio
            asyncio.create_task(app.state.database.prewarm(4))
        logger.info(
            "application_started",
            extra={"environment": resolved_settings.environment, "database_configured": bool(resolved_settings.database_url)},
        )
        try:
            yield
        finally:
            if hasattr(app.state, "media_storage") and hasattr(app.state.media_storage, "dispose"):
                try:
                    await app.state.media_storage.dispose()
                except Exception:
                    pass
            await app.state.database.dispose()
            logger.info("application_stopped")

    app = FastAPI(
        title="Bóc Băng AI API",
        version="0.1.0",
        description="Backend foundation. Public endpoints are versioned under /api/v1.",
        lifespan=lifespan,
        openapi_url=f"{API_V1_PREFIX}/openapi.json",
        docs_url=f"{API_V1_PREFIX}/docs",
        redoc_url=f"{API_V1_PREFIX}/redoc",
    )
    app.state.settings = resolved_settings
    app.state.email_sender = build_email_sender(resolved_settings)
    # Provider instances and their credentials are constructed only in the backend.
    app.state.stt_provider = build_stt_provider(resolved_settings)
    app.state.speaker_enrollment_provider = build_speaker_enrollment_provider(
        resolved_settings
    )
    app.state.translation_provider = build_translation_provider(resolved_settings)
    app.state.llm_provider = build_llm_provider(resolved_settings)
    # This validates S3 configuration during app construction and never falls
    # back to an ephemeral filesystem when object storage is requested.
    app.state.media_storage = build_storage_backend(resolved_settings)
    def safe_enqueue_job(job_id, settings=None):
        from uuid import UUID
        jid = job_id if isinstance(job_id, UUID) else UUID(str(job_id))
        resolved = settings or resolved_settings

        # 1. Try enqueuing to Dramatiq/Redis broker first if configured
        broker_enqueued = False
        if getattr(resolved, "redis_url", None):
            try:
                from app.workers.broker import enqueue_job as broker_enqueue
                broker_enqueue(jid, resolved)
                broker_enqueued = True
            except Exception as exc:
                logger.warning("Broker enqueue failed, falling back to local task: %s", exc)

        # 2. If not enqueued to broker, run as in-process async background task safely
        if not broker_enqueued:
            from app.workers.tasks import _execute
            import asyncio
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_execute(jid))
            except RuntimeError:
                import threading
                threading.Thread(target=lambda: asyncio.run(_execute(jid)), daemon=True).start()

    app.state.enqueue_job = safe_enqueue_job
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.frontend_origins),
        allow_origin_regex=r"^https?://.*",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    app.add_middleware(RequestContextMiddleware)
    register_exception_handlers(app)

    @app.get("/", summary="Root health check")
    @app.get("/healthz", summary="Liveness probe")
    async def root_health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(api_router, prefix=API_V1_PREFIX)
    return app


app = create_app()
