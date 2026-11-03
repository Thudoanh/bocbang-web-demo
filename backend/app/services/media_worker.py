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
from app.models.enums import MeetingStatus
from app.models.media import Job, MediaFile
from app.models.meeting import Meeting
from app.core.logging import get_logger
from app.providers.contracts import STTProvider, STTProviderError, TranscriptionSegment
from app.providers.storage import MediaStorage

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
                await session.commit()
                from app.services.meetings import invalidate_meeting_cache
                invalidate_meeting_cache(meeting.id)
                from app.api.v1.routes.meetings import invalidate_bundle_cache
                invalidate_bundle_cache(meeting.id)

                # Complete the job right now so user UI unblocks without waiting for translation
                await lifecycle.completed(session, job)

                # 2. Asynchronous background translation: bóc băng trước, dịch sau trong nền
                # Không bắt người dùng phải chờ đợi ở màn hình tải tệp
                version_id = meeting.current_transcript_version_id
                if version_id:
                    asyncio.create_task(self._background_auto_translate(meeting.id, version_id))

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

    async def _background_auto_translate(self, meeting_id: UUID, version_id: UUID) -> None:
        """Translate segments in background without blocking file upload / STT completion."""
        try:
            import re
            from sqlalchemy import select
            from app.models.transcript import CurrentSegment, Transcript
            from app.models.translation import Translation, TranslationSegment
            from app.services.broadcaster import meeting_broadcaster
            from app.providers.google_translate import GoogleTranslateProvider

            async with self._database.session() as session:
                transcript_record = await session.scalar(
                    select(Transcript).where(Transcript.meeting_id == meeting_id)
                )
                if not transcript_record:
                    return
                current_segs = list(
                    await session.scalars(
                        select(CurrentSegment)
                        .where(CurrentSegment.transcript_id == transcript_record.id)
                        .order_by(CurrentSegment.position, CurrentSegment.start_ms)
                    )
                )
                if not current_segs:
                    return

                from app.providers.translation import build_translation_provider
                translator = build_translation_provider(self._settings)

                sample_text = " ".join(cs.text for cs in current_segs[:5])
                is_vi = any(c in sample_text.casefold() for c in "ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ")
                tgt = "en" if is_vi else "vi"
                src = "vi" if is_vi else "en"

                input_segments = tuple(
                    TranscriptionSegment(start_ms=cs.start_ms, end_ms=cs.end_ms, text=cs.text)
                    for cs in current_segs
                )
                try:
                    translated_segments = await translator.translate_segments(input_segments, src, tgt)
                except Exception as tr_err:
                    logger.warning("Translator batch translation non-fatal error: %s", tr_err)
                    translated_segments = input_segments

                translation_record = Translation(
                    meeting_id=meeting_id,
                    transcript_version_id=version_id,
                    source_language=src,
                    target_language=tgt,
                )
                session.add(translation_record)
                await session.flush()

                db_translation_segs = []
                for idx, cs in enumerate(current_segs):
                    tr_text = (
                        translated_segments[idx].text.strip()
                        if idx < len(translated_segments) and translated_segments[idx].text.strip()
                        else cs.text.strip()
                    )
                    db_translation_segs.append(
                        TranslationSegment(
                            translation_id=translation_record.id,
                            logical_segment_id=cs.logical_segment_id,
                            sequence=idx + 1,
                            text=tr_text,
                        )
                    )
                    meeting_broadcaster.set_translation(
                        meeting_id, str(cs.logical_segment_id), tr_text
                    )

                session.add_all(db_translation_segs)
                await session.commit()
                from app.services.meetings import invalidate_meeting_cache
                from app.api.v1.routes.meetings import invalidate_bundle_cache
                invalidate_meeting_cache(meeting_id)
                invalidate_bundle_cache(meeting_id)
                logger.info("Background translated and saved %d segments for meeting %s", len(db_translation_segs), meeting_id)
        except Exception as exc:
            logger.warning("Background translation non-fatal error for meeting %s: %s", meeting_id, exc)

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
