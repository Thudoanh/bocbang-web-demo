"""One serialized writer per socket; partials never enter STT version history."""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, or_, select
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
            or_(BrowserTranscriptDraft.recognition_status.is_(None), BrowserTranscriptDraft.recognition_status == "unconfirmed"),
        ).order_by(BrowserTranscriptDraft.start_ms, BrowserTranscriptDraft.stream_segment_id))
        return [self.response(row) for row in rows]

    async def is_resolved(self, meeting_id: UUID, stream_segment_id: str) -> bool:
        row = await self.session.get(BrowserTranscriptDraft, (meeting_id, stream_segment_id), populate_existing=True)
        return bool(row and row.recognition_status in {"confirmed", "discarded"})

    async def resolve(self, meeting_id, user, body):
        from decimal import Decimal
        from app.core.errors import ApiError
        from app.models.enums import TranscriptVersionSource
        from app.models.transcript import CurrentSegment, TranscriptVersion
        from app.services.meetings import MeetingService, invalidate_meeting_cache
        from app.services.transcripts import TranscriptService

        meeting, _ = await MeetingService(self.session).require_access(meeting_id, user, "edit")
        await self.session.refresh(meeting, with_for_update=True)
        if meeting.stt_mode != "browser":
            raise ApiError("STT_MODE_INVALID", "Draft recovery requires Browser mode.", 409)
        row = await self.session.get(BrowserTranscriptDraft, (meeting_id, body.stream_segment_id), populate_existing=True)
        if row is None:
            raise ApiError("BROWSER_DRAFT_NOT_FOUND", "Đoạn này đã được chốt hoặc xóa. Vui lòng tải lại transcript.", 404)
        resolved = "confirmed" if body.action in {"confirm", "recover"} else "discarded"
        if row.recognition_status in {"confirmed", "discarded"}:
            if row.recognition_status != resolved:
                raise ApiError("VERSION_CONFLICT", "Đoạn này đã được xử lý. Vui lòng tải lại.", 409)
            return row, None
        if row.revision != body.revision:
            raise ApiError("VERSION_CONFLICT", "Nội dung vừa thay đổi. Hãy kiểm tra bản mới nhất trước khi xác nhận.", 409)
        if row.recognition_status != "unconfirmed":
            raise ApiError("BROWSER_DRAFT_ACTIVE", "Đoạn này vẫn đang nhận diện. Hãy chờ nhận diện kết thúc.", 409)

        segment = None
        if body.action in {"confirm", "recover"}:
            automatic = body.action == "recover"
            service = TranscriptService(self.session)
            transcript = await service._ensure_transcript(meeting.id)
            rows = list(await self.session.scalars(select(CurrentSegment).where(
                CurrentSegment.transcript_id == transcript.id).order_by(CurrentSegment.position)))
            if any(s.start_ms < row.end_ms and s.end_ms > row.start_ms for s in rows):
                raise ApiError("BROWSER_DRAFT_OVERLAP", "Đoạn này chồng thời gian với văn bản đã xác nhận. Hãy kiểm tra transcript trước.", 409)
            parent = await service._current_version_or_none(meeting)
            if parent and transcript.current_projection_initialized_at is None:
                raise ApiError("TRANSCRIPT_PROJECTION_UNAVAILABLE", "Transcript cũ cần được cập nhật trước khi thêm đoạn.", 409)
            version = TranscriptVersion(
                transcript_id=transcript.id, version_no=await service._next_version_no(transcript.id),
                source=TranscriptVersionSource.STT if automatic else TranscriptVersionSource.USER_EDIT,
                parent_version_id=parent.id if parent else None, created_by=user.id,
            )
            self.session.add(version)
            await self.session.flush()
            right = next((i for i, s in enumerate(rows) if s.start_ms >= row.start_ms), len(rows))
            before = rows[right - 1].position if right else None
            after = rows[right].position if right < len(rows) else None
            position = (before + after) / 2 if before is not None and after is not None else (
                after - 1024 if after is not None else (before or Decimal(0)) + 1024)
            segment = CurrentSegment(transcript_id=transcript.id, position=position,
                start_ms=row.start_ms, end_ms=row.end_ms, text=row.text, original_stt_text=row.text if automatic else None)
            self.session.add(segment)
            await self.session.flush()
            transcript.current_projection_initialized_at = transcript.current_projection_initialized_at or datetime.now(UTC)
            await service._event(transcript, version, user.id, "browser_auto_commit" if automatic else "browser_draft_confirm", {
                "stream_segment_id": row.stream_segment_id, "logical_segment_id": str(segment.logical_segment_id),
                "start_ms": row.start_ms, "end_ms": row.end_ms, "text": row.text,
                "confirmation_source": "application" if automatic else "user",
                "engine_confirmed": False,
            })
            await service._checkpoint(transcript, version)
            meeting.current_transcript_version_id = version.id
            meeting.duration_ms = max(meeting.duration_ms or 0, row.end_ms)
        # Retain a tombstone so delayed/replayed Web Speech messages cannot
        # recreate this draft or append the same words a second time.
        row.recognition_status = resolved
        row.updated_at = datetime.now(UTC)
        await self.session.commit()
        invalidate_meeting_cache(meeting.id)
        return row, segment

    async def save(self, meeting_id: UUID, *, stream_segment_id: str, language: str,
                   text: str, start_ms: int, end_ms: int, revision: int,
                   recognition_status: str | None) -> BrowserDraftResponse | None:
        row = await self.session.get(BrowserTranscriptDraft, (meeting_id, stream_segment_id))
        if row is not None and row.recognition_status in {"confirmed", "discarded"}:
            return None
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
            or_(BrowserTranscriptDraft.recognition_status.is_(None), BrowserTranscriptDraft.recognition_status == "unconfirmed"),
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
            if row.recognition_status not in {"confirmed", "discarded"}:
                row.recognition_status = "unconfirmed"
        await self.session.commit()
