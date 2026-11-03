"""One serialized writer per socket; partials never enter STT version history."""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.browser_draft import BrowserTranscriptDraft
from app.schemas.browser_draft import BrowserDraftResponse


class BrowserDraftService:
    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def response(row: BrowserTranscriptDraft) -> BrowserDraftResponse:
        return BrowserDraftResponse(
            stream_segment_id=row.stream_segment_id, language=row.language,
            text=row.text, start_ms=row.start_ms, end_ms=row.end_ms,
            revision=row.revision, draft_saved_revision=row.revision,
            draft_saved_at=row.updated_at, recognition_status=row.recognition_status,
        )

    async def list(self, meeting_id: UUID) -> list[BrowserDraftResponse]:
        rows = await self.session.scalars(select(BrowserTranscriptDraft).where(
            BrowserTranscriptDraft.meeting_id == meeting_id,
        ).order_by(BrowserTranscriptDraft.start_ms, BrowserTranscriptDraft.stream_segment_id))
        return [self.response(row) for row in rows]

    async def save(self, meeting_id: UUID, *, stream_segment_id: str, language: str,
                   text: str, start_ms: int, end_ms: int, revision: int,
                   recognition_status: str | None) -> BrowserDraftResponse:
        row = await self.session.get(BrowserTranscriptDraft, (meeting_id, stream_segment_id))
        if row is None:
            row = BrowserTranscriptDraft(meeting_id=meeting_id, stream_segment_id=stream_segment_id)
            self.session.add(row)
        elif row.revision > revision:
            return self.response(row)
        row.language, row.text = language, text
        row.start_ms, row.end_ms, row.revision = start_ms, end_ms, revision
        row.recognition_status = recognition_status
        row.updated_at = datetime.now(UTC)
        await self.session.commit()
        return self.response(row)

    async def remove(self, meeting_id: UUID, stream_segment_id: str,
                     revision: int | None = None) -> None:
        statement = delete(BrowserTranscriptDraft).where(
            BrowserTranscriptDraft.meeting_id == meeting_id,
            BrowserTranscriptDraft.stream_segment_id == stream_segment_id,
        )
        if revision is not None:
            statement = statement.where(BrowserTranscriptDraft.revision <= revision)
        # Caller commits together with the final write or explicit withdrawal.
        await self.session.execute(statement)

    async def interrupt(self, meeting_id: UUID, stream_session_id: str) -> None:
        rows = await self.session.scalars(select(BrowserTranscriptDraft).where(
            BrowserTranscriptDraft.meeting_id == meeting_id,
            BrowserTranscriptDraft.stream_segment_id.startswith(stream_session_id + ":"),
        ))
        for row in rows:
            row.recognition_status = "unconfirmed"
        await self.session.commit()
