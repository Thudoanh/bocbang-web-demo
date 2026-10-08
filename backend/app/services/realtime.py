"""Persist normalized final realtime-STT results without persisting partials."""

from __future__ import annotations

from dataclasses import replace
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.transcript import CurrentSegment, Speaker, Transcript
from app.models.user import User
from app.providers.contracts import TranscriptionSegment
from app.schemas.transcript import TranscriptMutationResponse
from app.services.transcripts import TranscriptService
from app.services.voice_embedding import (
    VoiceCandidate,
    extract_embedding_from_pcm16,
    match_candidate,
)


class RealtimeTranscriptService:
    """Owns durable final-segment writes for one realtime socket session."""

    def __init__(
        self,
        session: AsyncSession,
        meeting: Meeting,
        actor_id: UUID,
        candidates: list[VoiceCandidate] | None = None,
    ) -> None:
        self._session = session
        self._meeting = meeting
        self._actor_id = actor_id
        self._diarization_enabled = meeting.diarization_enabled
        self._speaker_scope = uuid4().hex
        self._turns: dict[int, UUID] = {}
        self._time_offset_ms = meeting.duration_ms or 0
        self._started_stt_version = False
        self._candidates = candidates or []
        self._audio_buffer = bytearray()
        self._max_buffer_bytes = 16000 * 2 * 60  # 60s max ring buffer

    def feed_audio(self, chunk: bytes) -> None:
        self._audio_buffer.extend(chunk)
        if len(self._audio_buffer) > self._max_buffer_bytes:
            self._audio_buffer = self._audio_buffer[-self._max_buffer_bytes :]

    def _scoped_label(self, label: str | None) -> str | None:
        if not self._diarization_enabled or not label:
            return None
        return f"realtime:{self._speaker_scope}:{label}"

    @property
    def diarization_enabled(self) -> bool:
        return self._diarization_enabled

    async def recording_started(self) -> None:
        if self._meeting.status in {
            MeetingStatus.CREATED,
            MeetingStatus.PROCESSING,
            MeetingStatus.FAILED,
        }:
            self._meeting.status = MeetingStatus.RECORDING
            await self._session.commit()

    async def recording_ended(self) -> None:
        """A realtime socket ending is not a successful processing completion."""
        if self._meeting.status == MeetingStatus.RECORDING:
            self._meeting.status = MeetingStatus.PROCESSING
            await self._session.commit()

    async def recording_failed(self) -> None:
        self._meeting.status = MeetingStatus.FAILED
        await self._session.commit()

    async def persist_final(self, segment: TranscriptionSegment, turn_order: int | None = None):
        """Persist through the common STT ingestion boundary used by batch workers too."""
        candidate_name: str | None = None
        voice_profile_id: UUID | None = None
        match_confidence: float | None = None

        if self._candidates and len(self._audio_buffer) >= 16000:
            turn_duration_ms = max(500, segment.end_ms - segment.start_ms)
            turn_bytes = int(turn_duration_ms / 1000 * 16000 * 2)
            audio_slice = bytes(self._audio_buffer[-turn_bytes:]) if turn_bytes <= len(self._audio_buffer) else bytes(self._audio_buffer)
            try:
                emb = extract_embedding_from_pcm16(audio_slice)
                matched, conf = match_candidate(emb, self._candidates, threshold=0.72)
                if matched:
                    candidate_name = matched.name
                    voice_profile_id = matched.id
                    match_confidence = conf
            except Exception:
                pass

        stored = await TranscriptService(self._session).append_stt_final(
            self._meeting, self._actor_id,
            replace(
                segment, speaker_label=self._scoped_label(segment.speaker_label),
                start_ms=segment.start_ms + self._time_offset_ms,
                end_ms=segment.end_ms + self._time_offset_ms,
            ),
            start_new_version=not self._started_stt_version,
            candidate_name=candidate_name,
            voice_profile_id=voice_profile_id,
            match_confidence=match_confidence,
        )
        self._started_stt_version = True
        self._meeting.duration_ms = max(self._meeting.duration_ms or 0, stored.end_ms)
        await self._session.commit()
        if turn_order is not None:
            self._turns[turn_order] = stored.logical_segment_id
        return stored

    async def revise_speaker(
        self, turn_order: int, label: str | None
    ) -> TranscriptMutationResponse | None:
        logical_id = self._turns.get(turn_order)
        if logical_id is None or not self._diarization_enabled:
            return None
        user = await self._session.get(User, self._actor_id)
        if user is None:
            return None
        mutation = await TranscriptService(self._session).revise_stt_speaker(
            logical_id, user, self._scoped_label(label)
        )
        # Even an unchanged/protected turn acquired the meeting lock. Do not
        # hold it while waiting for the next audio message on this socket.
        await self._session.commit()
        return mutation

    async def get_speaker(self, speaker_id: UUID | None) -> Speaker | None:
        if speaker_id is None:
            return None
        return await self._session.get(Speaker, speaker_id)

    async def translation_inputs(
        self, logical_segment_ids: tuple[UUID, ...]
    ) -> tuple[tuple[UUID, TranscriptionSegment], ...]:
        """Load trusted current transcript text for client-requested realtime backfill."""
        if not logical_segment_ids:
            return ()
        rows = list(
            await self._session.scalars(
                select(CurrentSegment)
                .join(Transcript, CurrentSegment.transcript_id == Transcript.id)
                .where(
                    Transcript.meeting_id == self._meeting.id,
                    CurrentSegment.logical_segment_id.in_(logical_segment_ids),
                )
            )
        )
        by_id = {row.logical_segment_id: row for row in rows}
        if any(logical_id not in by_id for logical_id in logical_segment_ids):
            raise ValueError("A realtime translation segment was not found in this meeting.")
        return tuple(
            (
                logical_id,
                TranscriptionSegment(
                    start_ms=by_id[logical_id].start_ms,
                    end_ms=by_id[logical_id].end_ms,
                    text=by_id[logical_id].text,
                    confidence=by_id[logical_id].confidence,
                ),
            )
            for logical_id in logical_segment_ids
        )
