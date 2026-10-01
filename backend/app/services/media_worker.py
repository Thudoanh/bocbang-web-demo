"""Durable worker for normalization and batch transcription jobs."""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import Database
from app.models.enums import JobStatus, MeetingStatus
from app.models.media import Job, MediaFile
from app.models.meeting import Meeting
from app.providers.contracts import STTProvider, STTProviderError
from app.providers.storage import MediaStorage
from app.services.transcripts import TranscriptService


class MediaProcessingWorker:
    """Claims one queued media job. Safe to run from web or a dedicated worker."""

    def __init__(self, database: Database, storage: MediaStorage, stt: STTProvider | None) -> None:
        self._database, self._storage, self._stt = database, storage, stt
        self._tasks: set[asyncio.Task[None]] = set()

    def enqueue(self, job_id: UUID) -> None:
        task = asyncio.create_task(self.run(job_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def run(self, job_id: UUID) -> None:
        async with self._database.session() as session:
            job = await session.get(Job, job_id)
            if job is None or job.job_type != "media_processing" or job.status != JobStatus.QUEUED:
                return
            media = await session.get(MediaFile, job.media_file_id)
            meeting = await session.get(Meeting, job.meeting_id)
            if media is None or meeting is None or media.deleted_at is not None:
                await self._fail(session, job, "MEDIA_DELETED", "The source media was deleted before processing.", False)
                return
            if self._stt is None or not self._stt.capabilities().batch:
                await self._fail(session, job, "PROVIDER_CAPABILITY_UNAVAILABLE", "Batch transcription is not configured.", False)
                return
            job.status, job.progress, media.status, meeting.status = JobStatus.PROCESSING, 10, "processing", MeetingStatus.PROCESSING
            await session.commit()
            source: Path | None = None
            normalized: Path | None = None
            try:
                source, normalized = await self._normalize(media)
                normalized_key = f"meetings/{meeting.id}/media/{media.id}.normalized.wav"
                await self._storage.put_file(normalized, normalized_key)
                media.normalized_storage_key, job.progress = normalized_key, 45
                await session.commit()
                result = await self._stt.transcribe_file(normalized_key)
                if not result.segments:
                    raise ValueError("STT provider returned no transcript segments.")
                await TranscriptService(session).replace_stt_batch(
                    meeting, meeting.owner_id, result.segments
                )
                meeting.duration_ms = media.duration_ms
                meeting.status, media.status, job.status, job.progress = MeetingStatus.COMPLETED, "completed", JobStatus.COMPLETED, 100
                job.error_code = job.error_message = None
                job.error_retryable = None
                await session.commit()
            except STTProviderError as exc:
                await self._fail(session, job, exc.code, str(exc), exc.retryable)
            except ValueError as exc:
                await self._fail(session, job, "STT_RESULT_INVALID", str(exc), False)
            except Exception:
                await self._fail(session, job, "MEDIA_PROCESSING_ERROR", "Media processing could not complete.", True)
            finally:
                for path in (source, normalized):
                    if path:
                        try:
                            await asyncio.to_thread(path.unlink, missing_ok=True)
                        except OSError:
                            pass

    async def _normalize(self, media: MediaFile) -> tuple[Path, Path]:
        content = await self._storage.get_bytes(media.storage_key)
        source_fd, source_name = tempfile.mkstemp(prefix="bocbang-source-", suffix=Path(media.original_filename).suffix)
        normalized_fd, normalized_name = tempfile.mkstemp(prefix="bocbang-normalized-", suffix=".wav")
        source, normalized = Path(source_name), Path(normalized_name)
        try:
            with os.fdopen(source_fd, "wb") as destination:
                destination.write(content)
            os.close(normalized_fd)
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(normalized),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()
            if process.returncode != 0 or not normalized.is_file() or normalized.stat().st_size == 0:
                raise ValueError(f"FFmpeg could not normalize the media: {stderr.decode(errors='replace')[:200]}")
            return source, normalized
        except Exception:
            for path in (source, normalized):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise

    @staticmethod
    async def _fail(session: AsyncSession, job: Job, code: str, message: str, retryable: bool) -> None:
        job_id = job.id
        await session.rollback()
        job = await session.get(Job, job_id)
        assert job is not None
        media = await session.get(MediaFile, job.media_file_id)
        meeting = await session.get(Meeting, job.meeting_id)
        job.status, job.progress = JobStatus.FAILED, 100
        job.error_code, job.error_message, job.error_retryable = code, message, retryable
        if media is not None and media.deleted_at is None:
            media.status = "failed"
        if meeting is not None:
            meeting.status = MeetingStatus.FAILED
        await session.commit()
