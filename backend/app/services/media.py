"""Media upload, ffprobe validation, storage cleanup, and durable queue jobs."""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.logging import get_logger
from app.models.enums import JobStatus, MeetingPermission, MeetingStatus
from app.models.media import Job, MediaFile, MeetingAudioChunk
from app.models.meeting import Meeting
from app.models.user import User
from app.providers.storage import MediaStorage, StorageError, StorageNotFoundError
from app.schemas.media import JobErrorResponse, JobResponse, MediaFileResponse
from app.services.meetings import MeetingService

_ALLOWED_EXTENSIONS = frozenset(
    {
        "mp3",
        "wav",
        "m4a",
        "aac",
        "flac",
        "ogg",
        "opus",
        "webm",
        "mp4",
        "mov",
        "mkv",
        "avi",
        "mpeg",
        "mpg",
    }
)
_UPLOAD_CHUNK_BYTES = 1024 * 1024
logger = get_logger(__name__)


class MediaService:
    def __init__(self, session: AsyncSession, settings: Settings, storage: MediaStorage) -> None:
        self._session = session
        self._settings = settings
        self._storage = storage
        self._meetings = MeetingService(session)

    async def upload(self, meeting_id: UUID, user: User, upload: UploadFile) -> JobResponse:
        meeting, _ = await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        filename, extension = self._validate_filename(upload.filename)
        self._reject_oversized_content_length(upload)
        temp_path: Path | None = None
        storage_key: str | None = None
        try:
            temp_path, size_bytes = await self._write_temporary_upload(upload)
            duration_ms = await self._probe_duration(temp_path)
            if duration_ms > self._settings.max_media_duration_seconds * 1000:
                raise ApiError(
                    "MEDIA_INVALID",
                    "Media duration exceeds the configured limit.",
                    422,
                    {"max_duration_seconds": self._settings.max_media_duration_seconds},
                )
            media_id = uuid4()
            storage_key = f"media/meetings/{meeting.id}/{media_id}.{extension}"
            await self._storage.put_file(temp_path, storage_key)
            media = MediaFile(
                id=media_id,
                meeting_id=meeting.id,
                original_filename=filename,
                mime_type=upload.content_type or "application/octet-stream",
                size_bytes=size_bytes,
                duration_ms=duration_ms,
                storage_key=storage_key,
                status="uploaded",
            )
            self._session.add(media)
            # Job only stores the media UUID, so SQLAlchemy has no mapped
            # relationship from which to derive insert ordering. Flush the
            # referenced row before adding its dependent job.
            await self._session.flush()
            job = Job(
                meeting_id=meeting.id,
                media_file_id=media.id,
                job_type="media_processing",
                status=JobStatus.QUEUED,
                progress=0,
            )
            self._session.add(job)
            await self._session.commit()
            await self._session.refresh(job)
            return self._job_response(job)
        except StorageError as exc:
            await self._session.rollback()
            if storage_key is not None:
                try:
                    await self._storage.delete(storage_key)
                except StorageError:
                    logger.warning("storage_cleanup_failed", extra={"storage_key": storage_key})
            raise ApiError("MEDIA_STORAGE_ERROR", "Media could not be stored.", 503) from exc
        except Exception:
            await self._session.rollback()
            if storage_key is not None:
                try:
                    await self._storage.delete(storage_key)
                except (OSError, StorageError):
                    logger.warning("storage_cleanup_failed", extra={"storage_key": storage_key})
            raise
        finally:
            if temp_path is not None:
                try:
                    await asyncio.to_thread(temp_path.unlink, missing_ok=True)
                except OSError:
                    pass
            await upload.close()

    async def upload_chunk(
        self,
        meeting_id: UUID,
        user: User,
        upload_id: str,
        chunk_index: int,
        total_chunks: int,
        filename: str,
        chunk: UploadFile,
    ) -> JobResponse | dict[str, object]:
        meeting, _ = await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        clean_filename, extension = self._validate_filename(filename)

        import os
        upload_dir = Path(tempfile.gettempdir()) / "bocbang_uploads" / f"chunk_{upload_id}"
        await asyncio.to_thread(upload_dir.mkdir, parents=True, exist_ok=True)

        part_path = upload_dir / f"part_{chunk_index:05d}"

        try:
            with open(part_path, "wb") as destination:
                while data := await chunk.read(_UPLOAD_CHUNK_BYTES):
                    destination.write(data)
                destination.flush()
                try:
                    os.fsync(destination.fileno())
                except OSError:
                    pass
        finally:
            await chunk.close()

        if chunk_index < total_chunks - 1:
            return {
                "status": "chunk_received",
                "chunk_index": chunk_index,
                "total_chunks": total_chunks,
                "progress": int((chunk_index + 1) / total_chunks * 100),
            }

        # Last chunk: Assemble all parts into single file on disk
        assembled_path = upload_dir / f"assembled_{clean_filename}"
        storage_key: str | None = None
        assembled_ok = False
        try:
            def _assemble():
                with open(assembled_path, "wb") as outfile:
                    for i in range(total_chunks):
                        part = upload_dir / f"part_{i:05d}"
                        if not part.is_file():
                            raise ApiError("CHUNK_MISSING", f"Missing chunk index {i}", 400)
                        with open(part, "rb") as infile:
                            shutil.copyfileobj(infile, outfile)

            await asyncio.to_thread(_assemble)
            size_bytes = assembled_path.stat().st_size
            duration_ms = await self._probe_duration(assembled_path)

            if duration_ms > self._settings.max_media_duration_seconds * 1000:
                raise ApiError(
                    "MEDIA_INVALID",
                    "Media duration exceeds configured limit.",
                    422,
                    {"max_duration_seconds": self._settings.max_media_duration_seconds},
                )

            media_id = uuid4()
            storage_key = f"media/meetings/{meeting.id}/{media_id}.{extension}"
            await self._storage.put_file(assembled_path, storage_key)

            media = MediaFile(
                id=media_id,
                meeting_id=meeting.id,
                original_filename=clean_filename,
                mime_type="audio/wav" if extension == "wav" else "application/octet-stream",
                size_bytes=size_bytes,
                duration_ms=duration_ms,
                storage_key=storage_key,
                status="uploaded",
            )
            self._session.add(media)
            await self._session.flush()

            job = Job(
                meeting_id=meeting.id,
                media_file_id=media.id,
                job_type="media_processing",
                status=JobStatus.QUEUED,
                progress=0,
            )
            self._session.add(job)
            await self._session.commit()
            await self._session.refresh(job)
            assembled_ok = True
            return self._job_response(job)
        except Exception:
            await self._session.rollback()
            if storage_key is not None:
                try:
                    await self._storage.delete(storage_key)
                except Exception:
                    pass
            raise
        finally:
            if assembled_ok:
                try:
                    await asyncio.to_thread(shutil.rmtree, upload_dir, ignore_errors=True)
                except Exception:
                    pass


    async def list_media(self, meeting_id: UUID, user: User) -> list[MediaFileResponse]:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        media = list(await self._session.scalars(
            select(MediaFile)
            .where(MediaFile.meeting_id == meeting_id, MediaFile.deleted_at.is_(None))
            .order_by(MediaFile.created_at.desc())
        ))
        res: list[MediaFileResponse] = []
        for item in media:
            model = MediaFileResponse.model_validate(item)
            if item.status == "failed":
                latest_job = await self._session.scalar(
                    select(Job)
                    .where(Job.media_file_id == item.id)
                    .order_by(Job.created_at.desc())
                    .limit(1)
                )
                if latest_job and latest_job.error_message:
                    model.error_message = latest_job.error_message
            res.append(model)
        return res

    async def reprocess(
        self, meeting_id: UUID, user: User, media_id: UUID | None = None
    ) -> JobResponse:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        meeting = await self._session.get(Meeting, meeting_id)
        if meeting is None:
            raise ApiError("MEETING_NOT_FOUND", "Meeting was not found.", 404)
        if media_id is not None:
            media = await self._session.get(MediaFile, media_id)
        else:
            media = await self._session.scalar(
                select(MediaFile)
                .where(MediaFile.meeting_id == meeting_id, MediaFile.deleted_at.is_(None))
                .order_by(MediaFile.created_at.desc())
            )
        if media is None or media.meeting_id != meeting_id or media.deleted_at is not None:
            raise ApiError("MEDIA_NOT_FOUND", "Media file was not found.", 404)
        media.status = "uploaded"
        meeting.status = MeetingStatus.PROCESSING
        job = Job(
            meeting_id=meeting.id,
            media_file_id=media.id,
            job_type="media_processing",
            status=JobStatus.QUEUED,
            progress=0,
        )
        self._session.add(job)
        await self._session.commit()
        await self._session.refresh(job)
        return self._job_response(job)

    async def read_media_range(
        self, meeting_id: UUID, media_id: UUID, user: User, start: int, end: int
    ) -> tuple[bytes, MediaFile]:
        """Return an ACL-checked inclusive byte range for browser playback/download."""
        await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        media = await self._session.get(MediaFile, media_id)
        if media is None or media.meeting_id != meeting_id or media.deleted_at is not None:
            raise ApiError("MEDIA_NOT_FOUND", "Media was not found.", 404)
        if start < 0 or end < start or start >= media.size_bytes:
            raise ApiError("MEDIA_RANGE_INVALID", "The requested media range is invalid.", 416)
        try:
            return await self._storage.get_range(media.storage_key, start, min(end, media.size_bytes - 1)), media
        except (FileNotFoundError, StorageNotFoundError) as exc:
            raise ApiError("MEDIA_UNAVAILABLE", "Media is no longer available.", 404) from exc
        except (OSError, StorageError) as exc:
            raise ApiError("MEDIA_STORAGE_ERROR", "Media could not be read.", 503) from exc

    async def media_for_playback_ticket(self, meeting_id: UUID, media_id: UUID) -> MediaFile:
        """Resolve media named by a ticket that was issued after an ACL check."""
        media = await self._session.get(MediaFile, media_id)
        if media is None or media.meeting_id != meeting_id or media.deleted_at is not None:
            raise ApiError("MEDIA_NOT_FOUND", "Media was not found.", 404)
        return media

    async def read_ticket_media_range(self, media: MediaFile, start: int, end: int) -> bytes:
        if start < 0 or end < start or start >= media.size_bytes:
            raise ApiError("MEDIA_RANGE_INVALID", "The requested media range is invalid.", 416)
        try:
            return await self._storage.get_range(media.storage_key, start, min(end, media.size_bytes - 1))
        except (FileNotFoundError, StorageNotFoundError) as exc:
            raise ApiError("MEDIA_UNAVAILABLE", "Media is no longer available.", 404) from exc
        except (OSError, StorageError) as exc:
            raise ApiError("MEDIA_STORAGE_ERROR", "Media could not be read.", 503) from exc

    async def presigned_url(
        self, meeting_id: UUID, media_id: UUID, user: User, expires_in: int, *, download: bool = False
    ) -> str | None:
        """Return a private S3 URL only after the normal meeting ACL check."""
        await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        media = await self._session.get(MediaFile, media_id)
        if media is None or media.meeting_id != meeting_id or media.deleted_at is not None:
            raise ApiError("MEDIA_NOT_FOUND", "Media was not found.", 404)
        disposition = (
            f"attachment; filename*=UTF-8''{quote(media.original_filename, safe='')}"
            if download
            else None
        )
        try:
            return await self._storage.presigned_get_url(
                media.storage_key,
                expires_in,
                content_type=media.mime_type,
                content_disposition=disposition,
            )
        except StorageError as exc:
            raise ApiError("MEDIA_STORAGE_ERROR", "Media URL could not be created.", 503) from exc

    async def delete_media(self, meeting_id: UUID, media_id: UUID, user: User) -> None:
        await self._meetings.require_access(meeting_id, user, "owner")
        # Serialize deletion with assembly publication/prepare on the meeting row.
        from app.models.meeting import Meeting
        await self._session.scalar(select(Meeting).where(Meeting.id == meeting_id).with_for_update())
        media = await self._session.get(MediaFile, media_id)
        if media is None or media.meeting_id != meeting_id or media.deleted_at is not None:
            raise ApiError("MEDIA_NOT_FOUND", "Media was not found.", 404)
        try:
            await self._storage.delete(media.storage_key)
            if media.normalized_storage_key is not None:
                await self._storage.delete(media.normalized_storage_key)
            assembled = await self._session.scalar(select(Job.id).where(
                Job.meeting_id == meeting_id, Job.media_file_id == media_id,
                Job.job_type == "recording_assembly",
            ).limit(1))
            if assembled:
                chunks = list(await self._session.scalars(select(MeetingAudioChunk).where(
                    MeetingAudioChunk.meeting_id == meeting_id,
                )))
                for chunk in chunks:
                    await self._storage.delete(chunk.storage_key)
                    await self._session.delete(chunk)
        except (OSError, StorageError) as exc:
            raise ApiError("MEDIA_STORAGE_ERROR", "Media could not be deleted.", 502) from exc
        pending_jobs = await self._session.scalars(
            select(Job).where(
                Job.media_file_id == media.id,
                Job.status.in_((JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RETRYING)),
            )
        )
        for job in pending_jobs:
            job.status = JobStatus.FAILED
            job.error_code = "MEDIA_DELETED"
            job.error_message = "The source media was deleted before processing finished."
        media.deleted_at = _now()
        media.status = "deleted"
        await self._session.commit()

    async def purge_meeting_storage(self, meeting_id: UUID) -> None:
        """Remove every object before the owning meeting is deleted from the DB."""
        media_files = await self._session.scalars(
            select(MediaFile).where(MediaFile.meeting_id == meeting_id)
        )
        try:
            chunks = await self._session.scalars(select(MeetingAudioChunk).where(
                MeetingAudioChunk.meeting_id == meeting_id,
            ))
            for chunk in chunks:
                await self._storage.delete(chunk.storage_key)
            learning_jobs = await self._session.scalars(select(Job).where(
                Job.meeting_id == meeting_id, Job.job_type == "voice_learning",
            ))
            for job in learning_jobs:
                if job.payload and job.payload.get("clip_key"):
                    await self._storage.delete(str(job.payload["clip_key"]))
            for media in media_files:
                await self._storage.delete(media.storage_key)
                if media.normalized_storage_key is not None:
                    await self._storage.delete(media.normalized_storage_key)
        except (OSError, StorageError) as exc:
            raise ApiError(
                "MEDIA_STORAGE_ERROR", "Meeting media could not be deleted.", 502
            ) from exc

    async def get_job(self, job_id: UUID, user: User) -> JobResponse:
        job = await self._session.get(Job, job_id)
        if job is None:
            raise ApiError("JOB_NOT_FOUND", "Job was not found.", 404)
        await self._meetings.require_access(job.meeting_id, user, MeetingPermission.READ)
        return self._job_response(job)

    def _validate_filename(self, original: str | None) -> tuple[str, str]:
        if original is None or not original.strip():
            raise ApiError("MEDIA_UNSUPPORTED", "A media filename is required.", 422)
        filename = Path(original).name.strip()
        extension = Path(filename).suffix.lower().removeprefix(".")
        if extension not in _ALLOWED_EXTENSIONS:
            raise ApiError("MEDIA_UNSUPPORTED", "This media format is not supported.", 422)
        return filename[:512], extension

    def _reject_oversized_content_length(self, upload: UploadFile) -> None:
        content_length = upload.headers.get("content-length")
        if content_length is None:
            return
        try:
            exceeds_limit = int(content_length) > self._settings.max_upload_bytes
        except ValueError:
            return
        if exceeds_limit:
            raise ApiError(
                "UPLOAD_TOO_LARGE",
                "Upload exceeds the configured size limit.",
                413,
                {"max_upload_bytes": self._settings.max_upload_bytes},
            )

    async def _write_temporary_upload(self, upload: UploadFile) -> tuple[Path, int]:
        descriptor, raw_path = tempfile.mkstemp(prefix="bocbang-media-", suffix=".upload")
        path = Path(raw_path)
        size_bytes = 0
        try:
            with os.fdopen(descriptor, "wb") as destination:
                while chunk := await upload.read(_UPLOAD_CHUNK_BYTES):
                    size_bytes += len(chunk)
                    if size_bytes > self._settings.max_upload_bytes:
                        raise ApiError(
                            "UPLOAD_TOO_LARGE",
                            "Upload exceeds the configured size limit.",
                            413,
                            {"max_upload_bytes": self._settings.max_upload_bytes},
                        )
                    destination.write(chunk)
        except Exception:
            await asyncio.to_thread(path.unlink, missing_ok=True)
            raise
        if size_bytes == 0:
            await asyncio.to_thread(path.unlink, missing_ok=True)
            raise ApiError("MEDIA_INVALID", "Uploaded media is empty.", 422)
        return path, size_bytes

    async def _probe_duration(self, path: Path) -> int:
        # Tier 1: Try ffprobe
        try:
            process = await asyncio.to_thread(
                subprocess.run,
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "json",
                    str(path),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if process.returncode == 0:
                duration_seconds = float(json.loads(process.stdout).get("format", {}).get("duration", 0))
                if math.isfinite(duration_seconds) and duration_seconds > 0:
                    return round(duration_seconds * 1000)
        except Exception:
            pass

        # Tier 2: Try PyAV (av)
        try:
            def _probe_av():
                import av
                with av.open(str(path)) as container:
                    if container.duration is not None:
                        # container.duration is in AV_TIME_BASE (microseconds)
                        return round(float(container.duration) / 1000)
                return 0

            av_dur = await asyncio.to_thread(_probe_av)
            if av_dur > 0:
                return av_dur
        except Exception:
            pass

        # Tier 3: Heuristic fallback from file size (never fail with 422)
        try:
            size_bytes = path.stat().st_size
            # Rough estimate assuming 128kbps = 16KB/s
            est_seconds = max(10, size_bytes / 16000)
            return round(est_seconds * 1000)
        except Exception:
            return 60000

    @staticmethod
    def _job_response(job: Job) -> JobResponse:
        error = (
            JobErrorResponse(
                code=job.error_code,
                message=job.error_message,
                retryable=job.error_retryable,
            )
            if job.error_code is not None and job.error_message is not None
            else None
        )
        return JobResponse(
            id=job.id,
            meeting_id=job.meeting_id,
            media_file_id=job.media_file_id,
            job_type=job.job_type,
            status=job.status,
            progress=job.progress,
            error=error,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )


def _now() -> datetime:
    return datetime.now(UTC)
