"""Redis-backed Dramatiq setup and the API-side enqueue boundary."""

from __future__ import annotations

from functools import lru_cache
from uuid import UUID

import dramatiq
from dramatiq.brokers.redis import RedisBroker

from app.core.config import Settings, get_settings


@lru_cache(maxsize=1)
def configure_broker(redis_url: str) -> RedisBroker:
    broker = RedisBroker(url=redis_url)
    dramatiq.set_broker(broker)
    return broker


def ensure_broker(settings: Settings | None = None) -> RedisBroker:
    resolved = settings or get_settings()
    resolved.require_queue_configuration()
    assert resolved.redis_url is not None
    return configure_broker(resolved.redis_url)


def enqueue_job(job_id: UUID, settings: Settings | None = None) -> None:
    """Publish only a durable job identifier after the creating transaction commits."""
    resolved = settings or get_settings()
    ensure_broker(resolved)
    # Actor imports occur after broker setup so they bind to Redis, never the
    # Dramatiq default in-memory broker.
    from app.workers.tasks import execute_job

    execute_job.send_with_options(
        args=(str(job_id),),
        max_retries=resolved.worker_max_retries,
        min_backoff=resolved.worker_retry_min_backoff_ms,
        max_backoff=resolved.worker_retry_max_backoff_ms,
    )
