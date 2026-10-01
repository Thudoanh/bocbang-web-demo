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
from app.providers.stt import build_stt_provider
from app.providers.storage import FileSystemMediaStorage
from app.providers.translation import build_translation_provider
from app.services.ai import AIJobDispatcher
from app.services.media_worker import MediaProcessingWorker

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create an application instance with explicit, testable dependencies."""
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(resolved_settings.log_level)
        app.state.database = Database(resolved_settings.database_url)
        app.state.ai_job_dispatcher = AIJobDispatcher(
            app.state.database,
            resolved_settings,
            app.state.translation_provider,
            app.state.llm_provider,
            app.state.media_storage,
        )
        app.state.media_worker = MediaProcessingWorker(
            app.state.database, app.state.media_storage, app.state.stt_provider
        )
        logger.info(
            "application_started",
            extra={"environment": resolved_settings.environment, "database_configured": bool(resolved_settings.database_url)},
        )
        try:
            yield
        finally:
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
    app.state.translation_provider = build_translation_provider(resolved_settings)
    app.state.llm_provider = build_llm_provider(resolved_settings)
    app.state.media_storage = FileSystemMediaStorage(resolved_settings.media_storage_path)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.frontend_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    register_exception_handlers(app)
    app.include_router(api_router, prefix=API_V1_PREFIX)
    return app


app = create_app()
