"""Thin Dramatiq actor that executes a persisted job by identifier."""

from __future__ import annotations

import asyncio
from uuid import UUID

import dramatiq

from app.core.config import get_settings
from app.db.session import Database
from app.providers.llm import build_llm_provider
from app.providers.stt import build_stt_provider
from app.providers.storage import build_storage_backend
from app.providers.translation import build_translation_provider
from app.services.ai import AIJobDispatcher
from app.services.media_worker import MediaProcessingWorker


@dramatiq.actor
def execute_job(job_id: str) -> None:
    """Run only one durable job; retryability is determined from persisted state."""
    retry = asyncio.run(_execute(UUID(job_id)))
    if retry:
        raise dramatiq.Retry()


async def _execute(job_id: UUID) -> bool:
    settings = get_settings()
    database = Database(settings.database_url)
    try:
        storage = build_storage_backend(settings)
        media = MediaProcessingWorker(database, storage, build_stt_provider(settings), settings)
        ai = AIJobDispatcher(
            database,
            settings,
            build_translation_provider(settings),
            build_llm_provider(settings),
            storage,
        )
        return await media.run(job_id) if await _is_media(database, job_id) else await ai.run(job_id)
    finally:
        await database.dispose()


async def _is_media(database: Database, job_id: UUID) -> bool:
    from app.models.media import Job

    async with database.session() as session:
        job = await session.get(Job, job_id)
        return bool(job and job.job_type == "media_processing")
