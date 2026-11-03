"""Recover durable jobs that were committed but not delivered to Redis.

Run this as a small companion process in production. It is intentionally
separate from the Dramatiq consumer so queue delivery can be repaired even
when an API process exits between database commit and broker publish.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select

from app.core.config import Settings, get_settings
from app.db.session import Database
from app.models.enums import JobStatus
from app.models.media import Job
from app.workers.broker import enqueue_job

logger = logging.getLogger(__name__)


async def pending_job_ids(database: Database, batch_size: int) -> list[UUID]:
    """Return job IDs eligible for delivery without claiming application work.

    Duplicate delivery is safe: workers atomically move a job out of queued or
    retrying state before executing it.
    """
    now = datetime.now(UTC)
    async with database.session() as session:
        rows = await session.scalars(
            select(Job.id)
            .where(
                or_(
                    (Job.status == JobStatus.QUEUED)
                    & or_(Job.next_attempt_at.is_(None), Job.next_attempt_at <= now),
                    (Job.status == JobStatus.RETRYING)
                    & or_(Job.next_attempt_at.is_(None), Job.next_attempt_at <= now),
                )
            )
            .order_by(Job.created_at)
            .limit(batch_size)
        )
        return list(rows)


async def mark_delivery_attempt(database: Database, job_id: UUID, settings: Settings) -> None:
    """Avoid continually duplicating an unclaimed queued message under load.

    The timestamp is a delivery visibility timeout, not an execution lease. A
    worker clears it as it atomically claims the durable job. If no worker ever
    claims it, a later reconcile pass publishes it again.
    """
    async with database.session() as session:
        job = await session.get(Job, job_id)
        if job is not None and job.status == JobStatus.QUEUED:
            job.next_attempt_at = datetime.now(UTC) + timedelta(
                seconds=settings.worker_delivery_timeout_seconds
            )
            await session.commit()


async def reconcile_once(settings: Settings | None = None) -> int:
    resolved = settings or get_settings()
    resolved.require_queue_configuration()
    if not resolved.database_url:
        raise ValueError("DATABASE_URL is required to reconcile durable jobs.")
    database = Database(resolved.database_url)
    try:
        job_ids = await pending_job_ids(database, resolved.worker_reconcile_batch_size)
        delivered = 0
        for job_id in job_ids:
            try:
                await asyncio.to_thread(enqueue_job, job_id, resolved)
                await mark_delivery_attempt(database, job_id, resolved)
                delivered += 1
            except Exception:
                logger.exception("queue_reconcile_publish_failed", extra={"job_id": str(job_id)})
        return delivered
    finally:
        await database.dispose()


async def run_forever(settings: Settings | None = None) -> None:
    resolved = settings or get_settings()
    while True:
        await reconcile_once(resolved)
        await asyncio.sleep(resolved.worker_reconcile_interval_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile durable Bóc Băng jobs into Redis.")
    parser.add_argument("--once", action="store_true", help="Publish one bounded batch, then exit.")
    args = parser.parse_args()
    if args.once:
        asyncio.run(reconcile_once())
    else:
        asyncio.run(run_forever())


if __name__ == "__main__":
    main()
