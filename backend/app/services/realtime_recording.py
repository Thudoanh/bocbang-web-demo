"""Persist browser PCM from realtime sessions as one appendable WAV recording."""

from __future__ import annotations

import asyncio
import os
import tempfile
import wave
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaFile
from app.models.meeting import Meeting
from app.providers.storage import MediaStorage

_CHANNELS = 1
_SAMPLE_RATE = 16_000
_SAMPLE_WIDTH_BYTES = 2
_COPY_FRAMES = _SAMPLE_RATE * 10


class RealtimeRecordingError(RuntimeError):
    """Raised when realtime PCM cannot be persisted as meeting audio."""


class RealtimeRecordingService:
    """Collect one socket's PCM and append it to the meeting's durable WAV."""

    def __init__(
        self,
        session: AsyncSession,
        meeting: Meeting,
        storage: MediaStorage,
    ) -> None:
        descriptor, raw_name = tempfile.mkstemp(
            prefix="bocbang-realtime-", suffix=".pcm"
        )
        self._session = session
        self._meeting = meeting
        self._storage = storage
        self._raw_path = Path(raw_name)
        self._raw_file = os.fdopen(descriptor, "wb")
        self._bytes_written = 0
        self._media: MediaFile | None = None
        self._timeline_offset_ms = max(0, meeting.duration_ms or 0)
        self._finalized = False

    @property
    def timeline_offset_ms(self) -> int:
        return self._timeline_offset_ms

    async def start(self) -> None:
        self._media = await self._session.scalar(
            select(MediaFile)
            .where(
                MediaFile.meeting_id == self._meeting.id,
                MediaFile.deleted_at.is_(None),
            )
            .order_by(MediaFile.created_at.asc())
            .limit(1)
        )
        if self._media is not None:
            self._timeline_offset_ms = max(
                self._timeline_offset_ms, self._media.duration_ms
            )

    def write(self, chunk: bytes) -> None:
        if self._finalized or self._raw_file.closed or not chunk:
            return
        try:
            self._raw_file.write(chunk)
        except OSError as exc:
            raise RealtimeRecordingError(
                "The realtime audio chunk could not be buffered."
            ) from exc
        self._bytes_written += len(chunk)

    async def finalize(self) -> MediaFile | None:
        if self._finalized:
            return self._media
        if not self._raw_file.closed:
            self._raw_file.flush()
            self._raw_file.close()
        if self._bytes_written == 0:
            self._finalized = True
            await self._remove(self._raw_path)
            return self._media

        old_path: Path | None = None
        output_path: Path | None = None
        storage_key = self._media.storage_key if self._media is not None else None
        try:
            if self._media is not None:
                old_path = _temporary_path("bocbang-existing-", ".wav")
                await self._storage.download_file(self._media.storage_key, old_path)
            output_path = _temporary_path("bocbang-recording-", ".wav")
            total_frames = await asyncio.to_thread(
                _append_pcm_to_wav,
                self._raw_path,
                output_path,
                old_path,
            )
            duration_ms = max(1, round(total_frames * 1000 / _SAMPLE_RATE))
            size_bytes = output_path.stat().st_size
            if storage_key is None:
                media_id = uuid4()
                storage_key = f"media/meetings/{self._meeting.id}/{media_id}.wav"
            await self._storage.put_file(output_path, storage_key)

            if self._media is None:
                self._media = MediaFile(
                    id=media_id,
                    meeting_id=self._meeting.id,
                    original_filename=f"Ghi am - {self._meeting.title}.wav"[:512],
                    mime_type="audio/wav",
                    size_bytes=size_bytes,
                    duration_ms=duration_ms,
                    storage_key=storage_key,
                    status="ready",
                )
                self._session.add(self._media)
            else:
                self._media.mime_type = "audio/wav"
                self._media.size_bytes = size_bytes
                self._media.duration_ms = duration_ms
                self._media.status = "ready"
            self._meeting.duration_ms = max(
                self._meeting.duration_ms or 0, duration_ms
            )
            await self._session.commit()
            self._timeline_offset_ms = duration_ms
            self._finalized = True
            return self._media
        except Exception as exc:
            await self._session.rollback()
            self._finalized = True
            raise RealtimeRecordingError(
                "The realtime recording could not be saved."
            ) from exc
        finally:
            await self._remove(self._raw_path)
            if old_path is not None:
                await self._remove(old_path)
            if output_path is not None:
                await self._remove(output_path)

    @staticmethod
    async def _remove(path: Path) -> None:
        try:
            await asyncio.to_thread(path.unlink, missing_ok=True)
        except OSError:
            pass


def _temporary_path(prefix: str, suffix: str) -> Path:
    descriptor, name = tempfile.mkstemp(prefix=prefix, suffix=suffix)
    os.close(descriptor)
    return Path(name)


def _append_pcm_to_wav(
    raw_path: Path,
    output_path: Path,
    existing_wav_path: Path | None,
) -> int:
    total_frames = 0
    with wave.open(str(output_path), "wb") as destination:
        destination.setnchannels(_CHANNELS)
        destination.setsampwidth(_SAMPLE_WIDTH_BYTES)
        destination.setframerate(_SAMPLE_RATE)
        if existing_wav_path is not None:
            with wave.open(str(existing_wav_path), "rb") as existing:
                if (
                    existing.getnchannels() != _CHANNELS
                    or existing.getsampwidth() != _SAMPLE_WIDTH_BYTES
                    or existing.getframerate() != _SAMPLE_RATE
                ):
                    raise ValueError("Existing realtime audio has an incompatible format.")
                while frames := existing.readframes(_COPY_FRAMES):
                    destination.writeframesraw(frames)
                    total_frames += len(frames) // _SAMPLE_WIDTH_BYTES
        with raw_path.open("rb") as raw:
            while chunk := raw.read(_COPY_FRAMES * _SAMPLE_WIDTH_BYTES):
                if len(chunk) % _SAMPLE_WIDTH_BYTES:
                    chunk += b"\x00"
                destination.writeframesraw(chunk)
                total_frames += len(chunk) // _SAMPLE_WIDTH_BYTES
    return total_frames
