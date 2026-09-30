"""Transcript snapshots, segment editing, and meeting speaker management."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.models.enums import MeetingPermission, TranscriptVersionSource
from app.models.meeting import Meeting
from app.models.transcript import SegmentVersion, Speaker, Transcript, TranscriptVersion
from app.models.user import User
from app.providers.contracts import TranscriptionSegment
from app.schemas.transcript import (
    SegmentEditRequest,
    SegmentMergeRequest,
    SegmentResponse,
    SegmentSplitRequest,
    SegmentSpeakerRequest,
    SpeakerCreateRequest,
    SpeakerResponse,
    SpeakerUpdateRequest,
    TranscriptMutationResponse,
    TranscriptResponse,
    TranscriptVersionResponse,
)
from app.services.meetings import MeetingService


class TranscriptService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._meetings = MeetingService(session)

    async def current(self, meeting_id: UUID, user: User) -> TranscriptResponse:
        meeting, _ = await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        version = await self._current_version(meeting)
        return await self._transcript_response_async(meeting, version)

    async def versions(self, meeting_id: UUID, user: User) -> list[TranscriptVersionResponse]:
        meeting, _ = await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        transcript = await self._session.scalar(select(Transcript).where(Transcript.meeting_id == meeting.id))
        if transcript is None:
            return []
        versions = await self._session.scalars(
            select(TranscriptVersion)
            .where(TranscriptVersion.transcript_id == transcript.id)
            .order_by(TranscriptVersion.version_no.desc())
        )
        return [self._version_response(item) for item in versions]

    async def version(self, meeting_id: UUID, version_id: UUID, user: User) -> TranscriptResponse:
        meeting, _ = await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        version = await self._session.get(TranscriptVersion, version_id)
        if version is None or version.transcript_id != await self._transcript_id(meeting.id):
            raise ApiError("TRANSCRIPT_VERSION_NOT_FOUND", "Transcript version was not found.", 404)
        return await self._transcript_response_async(meeting, version)

    async def edit_segment(
        self, logical_id: UUID, user: User, payload: SegmentEditRequest
    ) -> TranscriptMutationResponse:
        return await self._mutate_segment(
            logical_id,
            user,
            lambda items, index: self._edit(items, index, payload),
        )

    async def split_segment(
        self, logical_id: UUID, user: User, payload: SegmentSplitRequest
    ) -> TranscriptMutationResponse:
        return await self._mutate_segment(
            logical_id,
            user,
            lambda items, index: self._split(items, index, payload),
        )

    async def delete_segment(self, logical_id: UUID, user: User) -> TranscriptMutationResponse:
        return await self._mutate_segment(logical_id, user, lambda items, index: items.pop(index) or None)

    async def assign_speaker(
        self, logical_id: UUID, user: User, payload: SegmentSpeakerRequest
    ) -> TranscriptMutationResponse:
        meeting, _, _ = await self._current_segment_with_meeting(logical_id, user)
        if payload.speaker_id is not None:
            speaker = await self._session.get(Speaker, payload.speaker_id)
            if speaker is None or speaker.meeting_id != meeting.id:
                raise ApiError("SPEAKER_NOT_FOUND", "Speaker was not found for this meeting.", 404)
        return await self._mutate_segment(
            logical_id,
            user,
            lambda items, index: self._set_speaker(items, index, payload.speaker_id),
        )

    async def merge_segments(
        self, payload: SegmentMergeRequest, user: User
    ) -> TranscriptMutationResponse:
        meeting, first, version = await self._current_segment_with_meeting(payload.first_segment_id, user)
        await self._meetings.require_access(meeting.id, user, MeetingPermission.EDIT)
        segments = await self._segments(version.id)
        positions = {item.logical_segment_id: index for index, item in enumerate(segments)}
        first_index = positions.get(payload.first_segment_id)
        second_index = positions.get(payload.second_segment_id)
        if first_index is None or second_index is None or second_index != first_index + 1:
            raise ApiError("SEGMENTS_NOT_MERGEABLE", "Segments must be adjacent in the current transcript.", 422)
        second = segments[second_index]
        if first.speaker_id != second.speaker_id or first.end_ms != second.start_ms:
            raise ApiError("SEGMENTS_NOT_MERGEABLE", "Segments must be contiguous and have the same speaker.", 422)
        mutable = [self._copy_data(item) for item in segments]
        mutable[first_index]["end_ms"] = second.end_ms
        mutable[first_index]["text"] = f"{first.text.rstrip()} {second.text.lstrip()}".strip()
        mutable.pop(second_index)
        return await self._save_snapshot(meeting, version, user.id, mutable, first_index)

    async def list_speakers(self, meeting_id: UUID, user: User) -> list[SpeakerResponse]:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        speakers = await self._session.scalars(
            select(Speaker).where(Speaker.meeting_id == meeting_id).order_by(Speaker.created_at, Speaker.id)
        )
        return [SpeakerResponse.model_validate(speaker) for speaker in speakers]

    async def create_speaker(
        self, meeting_id: UUID, user: User, payload: SpeakerCreateRequest
    ) -> SpeakerResponse:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        speaker = Speaker(meeting_id=meeting_id, name=payload.name.strip(), role=payload.role, organization=payload.organization)
        self._session.add(speaker)
        await self._session.commit()
        await self._session.refresh(speaker)
        return SpeakerResponse.model_validate(speaker)

    async def update_speaker(
        self, speaker_id: UUID, user: User, payload: SpeakerUpdateRequest
    ) -> SpeakerResponse:
        speaker = await self._session.get(Speaker, speaker_id)
        if speaker is None:
            raise ApiError("SPEAKER_NOT_FOUND", "Speaker was not found.", 404)
        await self._meetings.require_access(speaker.meeting_id, user, MeetingPermission.EDIT)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(speaker, field, value.strip() if field == "name" and value is not None else value)
        await self._session.commit()
        await self._session.refresh(speaker)
        return SpeakerResponse.model_validate(speaker)

    async def append_stt_final(
        self, meeting: Meeting, actor_id: UUID, segment: TranscriptionSegment
    ) -> SegmentVersion:
        """Shared ingestion boundary for realtime and future upload/batch STT."""
        if not segment.text.strip() or segment.start_ms < 0 or segment.end_ms <= segment.start_ms:
            raise ValueError("Final transcript result is invalid.")
        transcript = await self._ensure_transcript(meeting.id)
        version = await self._session.scalar(
            select(TranscriptVersion)
            .where(TranscriptVersion.transcript_id == transcript.id, TranscriptVersion.source == TranscriptVersionSource.STT)
            .order_by(TranscriptVersion.version_no.desc()).limit(1)
        )
        if version is None or meeting.current_transcript_version_id != version.id:
            previous = await self._current_version_or_none(meeting)
            version = TranscriptVersion(
                transcript_id=transcript.id,
                version_no=await self._next_version_no(transcript.id),
                source=TranscriptVersionSource.STT,
                parent_version_id=previous.id if previous else None,
                created_by=actor_id,
            )
            self._session.add(version)
            await self._session.flush()
            meeting.current_transcript_version_id = version.id
        speaker_id = await self._speaker_for_label(meeting.id, segment.speaker_label)
        sequence = int(await self._session.scalar(select(func.coalesce(func.max(SegmentVersion.sequence), 0) + 1).where(SegmentVersion.transcript_version_id == version.id)))
        stored = SegmentVersion(
            transcript_version_id=version.id, speaker_id=speaker_id, sequence=sequence,
            start_ms=segment.start_ms, end_ms=segment.end_ms, text=segment.text.strip(),
            original_stt_text=segment.text.strip(), confidence=segment.confidence,
        )
        self._session.add(stored)
        await self._session.commit()
        await self._session.refresh(stored)
        return stored

    async def _mutate_segment(
        self, logical_id: UUID, user: User, operation: Callable[[list[dict[str, object]], int], object]
    ) -> TranscriptMutationResponse:
        meeting, _, version = await self._current_segment_with_meeting(logical_id, user)
        await self._meetings.require_access(meeting.id, user, MeetingPermission.EDIT)
        items = [self._copy_data(item) for item in await self._segments(version.id)]
        index = next(index for index, item in enumerate(items) if item["logical_segment_id"] == logical_id)
        operation(items, index)
        return await self._save_snapshot(meeting, version, user.id, items, index if index < len(items) else None)

    async def _save_snapshot(self, meeting: Meeting, parent: TranscriptVersion, actor_id: UUID, items: list[dict[str, object]], changed_index: int | None) -> TranscriptMutationResponse:
        self._validate_segments(items)
        next_version = TranscriptVersion(
            transcript_id=parent.transcript_id, version_no=await self._next_version_no(parent.transcript_id),
            source=TranscriptVersionSource.USER_EDIT, parent_version_id=parent.id, created_by=actor_id,
        )
        self._session.add(next_version)
        await self._session.flush()
        stored: list[SegmentVersion] = []
        for sequence, item in enumerate(items, start=1):
            segment = SegmentVersion(transcript_version_id=next_version.id, sequence=sequence, **item)
            self._session.add(segment)
            stored.append(segment)
        meeting.current_transcript_version_id = next_version.id
        await self._session.commit()
        response_segment = None
        if changed_index is not None and changed_index < len(stored):
            response_segment = self._segment_response(stored[changed_index])
        return TranscriptMutationResponse(version_id=next_version.id, version_no=next_version.version_no, segment=response_segment)

    async def _current_segment_with_meeting(self, logical_id: UUID, user: User) -> tuple[Meeting, SegmentVersion, TranscriptVersion]:
        segment = await self._session.scalar(
            select(SegmentVersion)
            .join(TranscriptVersion, SegmentVersion.transcript_version_id == TranscriptVersion.id)
            .join(Transcript, TranscriptVersion.transcript_id == Transcript.id)
            .join(Meeting, Transcript.meeting_id == Meeting.id)
            .where(
                SegmentVersion.logical_segment_id == logical_id,
                Meeting.current_transcript_version_id == TranscriptVersion.id,
            )
        )
        if segment is None:
            raise ApiError("SEGMENT_NOT_FOUND", "Transcript segment was not found.", 404)
        version = await self._session.get(TranscriptVersion, segment.transcript_version_id)
        assert version is not None
        transcript = await self._session.get(Transcript, version.transcript_id)
        assert transcript is not None
        meeting = await self._session.get(Meeting, transcript.meeting_id)
        assert meeting is not None
        await self._meetings.require_access(meeting.id, user, MeetingPermission.READ)
        return meeting, segment, version

    async def _current_version(self, meeting: Meeting) -> TranscriptVersion:
        version = await self._current_version_or_none(meeting)
        if version is None:
            raise ApiError("TRANSCRIPT_NOT_FOUND", "No transcript exists for this meeting.", 404)
        return version

    async def _current_version_or_none(self, meeting: Meeting) -> TranscriptVersion | None:
        return await self._session.get(TranscriptVersion, meeting.current_transcript_version_id) if meeting.current_transcript_version_id else None

    async def _transcript_id(self, meeting_id: UUID) -> UUID | None:
        return await self._session.scalar(select(Transcript.id).where(Transcript.meeting_id == meeting_id))

    async def _ensure_transcript(self, meeting_id: UUID) -> Transcript:
        transcript = await self._session.scalar(select(Transcript).where(Transcript.meeting_id == meeting_id))
        if transcript is None:
            transcript = Transcript(meeting_id=meeting_id)
            self._session.add(transcript)
            await self._session.flush()
        return transcript

    async def _next_version_no(self, transcript_id: UUID) -> int:
        latest = await self._session.scalar(select(func.max(TranscriptVersion.version_no)).where(TranscriptVersion.transcript_id == transcript_id))
        return int(latest or 0) + 1

    async def _segments(self, version_id: UUID) -> list[SegmentVersion]:
        return list(await self._session.scalars(select(SegmentVersion).where(SegmentVersion.transcript_version_id == version_id).order_by(SegmentVersion.sequence)))

    async def _speaker_for_label(self, meeting_id: UUID, label: str | None) -> UUID | None:
        if not label:
            return None
        speaker = await self._session.scalar(select(Speaker).where(Speaker.meeting_id == meeting_id, Speaker.provider_speaker_id == label))
        if speaker is None:
            speaker = Speaker(meeting_id=meeting_id, provider_speaker_id=label, name=label)
            self._session.add(speaker)
            await self._session.flush()
        return speaker.id

    async def _transcript_response_async(self, meeting: Meeting, version: TranscriptVersion) -> TranscriptResponse:
        return TranscriptResponse(version_id=version.id, version_no=version.version_no, language=meeting.language_mode, segments=[self._segment_response(item) for item in await self._segments(version.id)])

    @staticmethod
    def _version_response(version: TranscriptVersion) -> TranscriptVersionResponse:
        return TranscriptVersionResponse(id=version.id, version_no=version.version_no, source=version.source, parent_version_id=version.parent_version_id, created_by=version.created_by, created_at=version.created_at)

    @staticmethod
    def _segment_response(segment: SegmentVersion) -> SegmentResponse:
        return SegmentResponse(id=segment.logical_segment_id, logical_segment_id=segment.logical_segment_id, start_ms=segment.start_ms, end_ms=segment.end_ms, text=segment.text, speaker_id=segment.speaker_id, confidence=segment.confidence)

    @staticmethod
    def _copy_data(segment: SegmentVersion) -> dict[str, object]:
        return {"logical_segment_id": segment.logical_segment_id, "speaker_id": segment.speaker_id, "start_ms": segment.start_ms, "end_ms": segment.end_ms, "text": segment.text, "original_stt_text": segment.original_stt_text, "confidence": segment.confidence}

    @staticmethod
    def _validate_segments(items: list[dict[str, object]]) -> None:
        last_end = 0
        for item in items:
            start, end = int(item["start_ms"]), int(item["end_ms"])
            if start < 0 or start >= end:
                raise ApiError("INVALID_SEGMENT_TIMESTAMPS", "Each segment must have start_ms earlier than end_ms.", 422)
            if not str(item["text"]).strip():
                raise ApiError("INVALID_SEGMENT_TEXT", "Transcript segment text must not be empty.", 422)
            if start < last_end:
                raise ApiError("INVALID_SEGMENT_ORDER", "Transcript segments must be chronologically ordered without overlap.", 422)
            last_end = end

    @staticmethod
    def _edit(items: list[dict[str, object]], index: int, payload: SegmentEditRequest) -> None:
        item = items[index]
        for field, value in payload.model_dump(exclude_unset=True).items():
            item[field] = value.strip() if field == "text" and isinstance(value, str) else value

    @staticmethod
    def _set_speaker(items: list[dict[str, object]], index: int, speaker_id: UUID | None) -> None:
        items[index]["speaker_id"] = speaker_id

    @staticmethod
    def _split(items: list[dict[str, object]], index: int, payload: SegmentSplitRequest) -> None:
        item = items[index]
        start, end = int(item["start_ms"]), int(item["end_ms"])
        if not start < payload.split_at_ms < end:
            raise ApiError("INVALID_SEGMENT_TIMESTAMPS", "split_at_ms must fall inside the segment.", 422)
        words = str(item["text"]).split()
        midpoint = max(1, len(words) // 2)
        first_text = payload.first_text.strip() if payload.first_text else " ".join(words[:midpoint])
        second_text = payload.second_text.strip() if payload.second_text else " ".join(words[midpoint:])
        if not first_text or not second_text:
            raise ApiError("INVALID_SEGMENT_SPLIT", "Both split segments require text.", 422)
        item["end_ms"] = payload.split_at_ms
        item["text"] = first_text
        second = dict(item)
        second["logical_segment_id"] = uuid4()
        second["start_ms"] = payload.split_at_ms
        second["end_ms"] = end
        second["text"] = second_text
        items.insert(index + 1, second)
