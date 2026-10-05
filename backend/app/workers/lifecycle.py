"""Canonical persisted lifecycle transitions for durable jobs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import Database
from app.models.enums import JobStatus
from app.models.media import Job


def _now() -> datetime:
    return datetime.now(UTC)


async def start(session: AsyncSession, job: Job) -> bool:
    """Claim a queued/retrying job. Completed or active jobs are safe no-ops."""
    if job.status not in {JobStatus.QUEUED, JobStatus.RETRYING}:
        return False
    job.status = JobStatus.PROCESSING
    job.progress = max(job.progress, 10)
    job.attempts += 1
    job.started_at = job.started_at or _now()
    job.next_attempt_at = None
    job.completed_at = None
    job.error_code = job.error_message = None
    job.error_retryable = None
    await session.commit()
    return True


async def completed(session: AsyncSession, job: Job) -> None:
    job.status, job.progress, job.completed_at = JobStatus.COMPLETED, 100, _now()
    job.next_attempt_at = None
    job.error_code = job.error_message = None
    job.error_retryable = None
    await session.commit()


async def retrying(
    session: AsyncSession,
    job: Job,
    code: str,
    message: str,
    *,
    min_backoff_ms: int,
    max_backoff_ms: int,
) -> None:
    await session.rollback()
    refreshed = await session.get(Job, job.id)
    assert refreshed is not None
    refreshed.status = JobStatus.RETRYING
    backoff_ms = min(max_backoff_ms, min_backoff_ms * (2 ** max(0, refreshed.attempts - 1)))
    refreshed.next_attempt_at = _now() + timedelta(milliseconds=backoff_ms)
    refreshed.error_code, refreshed.error_message, refreshed.error_retryable = code, message, True
    refreshed.completed_at = None
    await session.commit()


async def failed(session: AsyncSession, job: Job, code: str, message: str, retryable: bool) -> None:
    await session.rollback()
    refreshed = await session.get(Job, job.id)
    assert refreshed is not None
    refreshed.status, refreshed.progress, refreshed.completed_at = JobStatus.FAILED, 100, _now()
    refreshed.next_attempt_at = None
    refreshed.error_code, refreshed.error_message, refreshed.error_retryable = code, message, retryable
    await session.commit()


async def fail_enqueue(database: Database, job_id: object) -> None:
    """Retain a publish-failed job for the reconciler instead of losing work.

    The HTTP request can still fail fast, but PostgreSQL remains authoritative:
    a later reconciler pass can publish this queued job after Redis recovers.
    """
    async with database.session() as session:
        job = await session.get(Job, job_id)
        if job is not None and job.status == JobStatus.QUEUED:
            job.error_code = "QUEUE_ENQUEUE_FAILED"
            job.error_message = "The job is waiting for queue delivery."
            job.error_retryable = True
            await session.commit()
