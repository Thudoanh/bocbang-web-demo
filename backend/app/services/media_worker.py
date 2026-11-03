"""Durable worker for original-file uploads and batch transcription jobs."""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from time import perf_counter
from uuid import UUID

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.session import Database
from app.models.enums import JobStatus, MeetingStatus
from app.models.media import Job, MediaFile
from app.models.meeting import Meeting
from app.core.logging import get_logger
from app.providers.contracts import STTProvider, STTProviderError
from app.providers.storage import MediaStorage
from app.providers.translation_validation import translation_source_language

logger = get_logger(__name__)
from app.services.transcripts import TranscriptService
from app.services.voice_profiles import VoiceProfileService
from app.workers import lifecycle


class MediaProcessingWorker:
    """Media/STT runner invoked only by a dedicated queue worker."""

    def __init__(self, database: Database, storage: MediaStorage, stt: STTProvider | None, settings: Settings) -> None:
        self._database, self._storage, self._stt, self._settings = database, storage, stt, settings

    async def run(self, job_id: UUID) -> bool:
        """Return whether Dramatiq should retry this persisted execution."""
        async with self._database.session() as session:
            job = await session.get(Job, job_id)
            if job is None or job.job_type != "media_processing" or not await lifecycle.start(session, job):
                return False
            media = await session.get(MediaFile, job.media_file_id)
            meeting = await session.get(Meeting, job.meeting_id)
            if media is None or meeting is None or media.deleted_at is not None:
                await self._fail(session, job, "MEDIA_DELETED", "The source media was deleted before processing.", False)
                return False
            if self._stt is None or not self._stt.capabilities().batch:
                await self._fail(session, job, "PROVIDER_CAPABILITY_UNAVAILABLE", "Batch transcription is not configured.", False)
                return False
            media.status, meeting.status = "processing", MeetingStatus.PROCESSING
            await session.commit()
            source: Path | None = None
            processing_started = perf_counter()
            timings: dict[str, float] = {}
            try:
                preparation_started = perf_counter()
                # Submit the original bytes, including on retry of meetings
                # that retain a normalized WAV from the previous policy.
                source = await self._download_source(media)
                stt_source = source
                timings["source_preparation_ms"] = round((perf_counter() - preparation_started) * 1000, 2)
                timings["normalization_ms"] = 0.0
                job.progress = 45
                await session.commit()
                known_speakers = await VoiceProfileService(session).list_known_speakers(
                    meeting.id
                )

                # Uploads must use the configured batch provider. A Groq key is
                # also used for translation/summary and must never override STT.
                stt_language = meeting.language_mode if meeting.language_mode in {"vi", "en"} else "auto"
                logger.info("media_processing_stage", extra={
                    "job_id": str(job.id), "stage": "transcription",
                    "provider": self._stt.__class__.__name__, "language": stt_language,
                })
                stt_started = perf_counter()
                result = await self._stt.transcribe_file(stt_source, stt_language, known_speakers)
                timings["transcription_ms"] = round((perf_counter() - stt_started) * 1000, 2)
                if not result or not result.segments:
                    raise ValueError("STT provider returned no transcript segments.")
                if result.language in {"vi", "en"}:
                    meeting.language_mode = result.language
                job.progress = 80
                await session.commit()

                if result.fallback_active:
                    payload = dict(job.payload or {})
                    payload["warning"] = {
                        "code": "STT_FALLBACK_ACTIVE",
                        "provider": result.provider_name or "assemblyai",
                        "speaker_identification_available": False,
                    }
                    job.payload = payload

                persistence_started = perf_counter()
                await TranscriptService(session).replace_stt_batch(
                    meeting, meeting.owner_id, result.segments
                )
                timings["persistence_ms"] = round((perf_counter() - persistence_started) * 1000, 2)
                timings["total_ms"] = round((perf_counter() - processing_started) * 1000, 2)
                job.payload = {**(job.payload or {}),
                    "transcript_version_id": str(meeting.current_transcript_version_id),
                    "stt_provider": result.provider_name or self._stt.__class__.__name__,
                    "stt_details": result.provider_metadata,
                    "stt_input": {"format": stt_source.suffix.lower(), "bytes": stt_source.stat().st_size,
                        "original_bytes": media.size_bytes, "native": True},
                    "processing_timings_ms": timings,
                }
                logger.info("media_processing_transcript_ready", extra={
                    "job_id": str(job.id), "provider": job.payload["stt_provider"],
                    "segment_count": len(result.segments),
                    "speaker_count": len({s.speaker_label for s in result.segments if s.speaker_label}),
                    "processing_timings_ms": timings,
                })
                meeting.duration_ms = media.duration_ms

                # Publish the transcript before optional translation finishes.
                meeting.status, media.status = MeetingStatus.COMPLETED, "completed"
                from app.services.meeting_sections import MeetingSectionService
                section = await MeetingSectionService(session).ensure(meeting)
                section.is_started = True
                section.end_ms = max(meeting.duration_ms or 0, max(row.end_ms for row in result.segments))
                # Commit translation work with the transcript. It must survive
                # asyncio.run() ending, worker shutdown and broker delivery errors.
                language = translation_source_language(meeting.language_mode, " ".join(s.text for s in result.segments[:5]))
                translation_job = Job(
                    meeting_id=meeting.id, job_type="translation", status=JobStatus.QUEUED, progress=0,
                    payload={"transcript_version_id": str(meeting.current_transcript_version_id),
                             "source_language": language, "target_language": "en" if language == "vi" else "vi",
                             "actor_id": str(meeting.owner_id), "source_upload_job_id": str(job.id)},
                )
                session.add(translation_job)
                await session.flush()
                translation_job_id = translation_job.id
                job.payload = {**job.payload, "translation_job_id": str(translation_job_id)}
                await session.commit()
                from app.services.meetings import invalidate_meeting_cache
                invalidate_meeting_cache(meeting.id)
                from app.api.v1.routes.meetings import invalidate_bundle_cache
                invalidate_bundle_cache(meeting.id)

                # Complete the job right now so user UI unblocks without waiting for translation
                await lifecycle.completed(session, job)

                from app.workers.broker import enqueue_job
                try:
                    await asyncio.to_thread(enqueue_job, translation_job_id, self._settings)
                except Exception:
                    # The reconciler republishes the durable queued job later.
                    logger.warning("upload_translation_waiting_for_delivery", extra={"job_id": str(translation_job_id)})

                return False
            except STTProviderError as exc:
                return await self._fail(session, job, exc.code, str(exc), exc.retryable)
            except ValueError as exc:
                return await self._fail(session, job, "MEDIA_PROCESSING_FAILED", str(exc), False)
            except Exception:
                return await self._fail(session, job, "MEDIA_PROCESSING_FAILED", "Media processing could not complete.", True)
            finally:
                if source:
                    try:
                        await asyncio.to_thread(source.unlink, missing_ok=True)
                    except OSError:
                        pass

    async def _download_source(self, media: MediaFile) -> Path:
        descriptor, name = tempfile.mkstemp(prefix="bocbang-source-", suffix=Path(media.original_filename).suffix.lower())
        path = Path(name)
        try:
            os.close(descriptor)
            await self._storage.download_file(media.storage_key, path)
            return path
        except Exception:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    async def _fail(self, session: AsyncSession, job: Job, code: str, message: str, retryable: bool) -> bool:
        job_id = (inspect(job).identity or (job.id,))[0]
        await session.rollback()
        job = await session.get(Job, job_id)
        assert job is not None
        media = await session.get(MediaFile, job.media_file_id)
        meeting = await session.get(Meeting, job.meeting_id)
        if media is not None and media.deleted_at is None:
            media.status = "failed"
        if meeting is not None:
            meeting.status = MeetingStatus.FAILED
        await session.commit()
        if retryable and job.attempts <= self._settings.worker_max_retries:
            await lifecycle.retrying(
                session,
                job,
                code,
                message,
                min_backoff_ms=self._settings.worker_retry_min_backoff_ms,
                max_backoff_ms=self._settings.worker_retry_max_backoff_ms,
            )
            return True
        await lifecycle.failed(session, job, code, message, retryable)
        return False
