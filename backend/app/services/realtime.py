"""Persist normalized final realtime-STT results without persisting partials."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.transcript import CurrentSegment, Transcript
from app.providers.contracts import TranscriptionSegment
from app.services.transcripts import TranscriptService


class RealtimeTranscriptService:
    """Owns durable final-segment writes for one realtime socket session."""

    def __init__(self, session: AsyncSession, meeting: Meeting, actor_id: UUID) -> None:
        self._session = session
        self._meeting = meeting
        self._actor_id = actor_id

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

    async def persist_final(self, segment: TranscriptionSegment):
        """Persist through the common STT ingestion boundary used by batch workers too."""
        stored = await TranscriptService(self._session).append_stt_final(
            self._meeting, self._actor_id, segment
        )
        self._meeting.duration_ms = max(self._meeting.duration_ms or 0, segment.end_ms)
        await self._session.commit()
        return stored

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
