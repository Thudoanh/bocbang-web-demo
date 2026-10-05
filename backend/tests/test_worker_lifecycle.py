import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from app.models.enums import JobStatus
from app.models.media import Job
from app.workers import lifecycle


class Session:
    def __init__(self, job: Job) -> None:
        self.job = job
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        return None

    async def get(self, _model: object, _id: object) -> Job:
        return self.job


def _job() -> Job:
    return Job(
        meeting_id=uuid4(), job_type="translation", status=JobStatus.QUEUED, progress=0, attempts=0
    )


def test_lifecycle_tracks_attempts_retry_and_terminal_timestamp() -> None:
    async def run() -> None:
        job = _job()
        session = Session(job)
        assert await lifecycle.start(session, job)
        assert job.status == JobStatus.PROCESSING
        assert job.attempts == 1 and job.started_at is not None and job.completed_at is None
        await lifecycle.retrying(
            session,
            job,
            "TRANSLATION_PROVIDER_FAILED",
            "Temporary failure",
            min_backoff_ms=10,
            max_backoff_ms=100,
        )
        assert job.status == JobStatus.RETRYING and job.completed_at is None
        assert job.next_attempt_at is not None
        assert await lifecycle.start(session, job)
        await lifecycle.completed(session, job)
        assert job.status == JobStatus.COMPLETED and job.completed_at is not None
        assert not await lifecycle.start(session, job)

    asyncio.run(run())


def test_failed_job_has_terminal_timestamp() -> None:
    async def run() -> None:
        job = _job()
        session = Session(job)
        await lifecycle.failed(session, job, "QUEUE_ENQUEUE_FAILED", "Queue unavailable", True)
        assert job.status == JobStatus.FAILED
        assert isinstance(job.completed_at, datetime)
        assert job.completed_at.tzinfo == UTC

    asyncio.run(run())
