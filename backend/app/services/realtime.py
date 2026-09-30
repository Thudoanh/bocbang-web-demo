"""Persist normalized final realtime-STT results without persisting partials."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.providers.contracts import TranscriptionSegment
from app.services.transcripts import TranscriptService


class RealtimeTranscriptService:
    """Owns durable final-segment writes for one realtime socket session."""

    def __init__(self, session: AsyncSession, meeting: Meeting, actor_id: UUID) -> None:
        self._session = session
        self._meeting = meeting
        self._actor_id = actor_id

    async def recording_started(self) -> None:
        if self._meeting.status in {MeetingStatus.CREATED, MeetingStatus.PROCESSING, MeetingStatus.FAILED}:
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
