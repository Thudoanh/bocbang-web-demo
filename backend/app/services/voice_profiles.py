"""Voice profile enrollment and candidate resolution service."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.models.enums import MeetingPermission
from app.models.meeting import Meeting, MeetingMember
from app.models.user import User
from app.models.voice_profile import VoiceProfile
from app.services.meetings import MeetingService
from app.services.voice_embedding import (
    VoiceCandidate,
    VoiceEmbeddingError,
    decode_audio_to_pcm16,
    extract_embedding_from_pcm16,
)


class VoiceProfileService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._meetings = MeetingService(session)

    async def get_user_profile(self, user: User) -> VoiceProfile | None:
        return await self._session.scalar(
            select(VoiceProfile).where(
                VoiceProfile.user_id == user.id,
                VoiceProfile.meeting_id.is_(None),
            )
        )

    async def enroll_user_profile(self, user: User, audio_bytes: bytes) -> VoiceProfile:
        try:
            pcm_bytes, duration_ms = decode_audio_to_pcm16(audio_bytes)
            if duration_ms < 1000:
                raise ApiError(
                    "AUDIO_TOO_SHORT",
                    "Mẫu âm thanh quá ngắn. Vui lòng ghi âm hoặc tải lên ít nhất 1 giây giọng nói.",
                    400,
                )
            embedding = extract_embedding_from_pcm16(pcm_bytes)
        except VoiceEmbeddingError as exc:
            raise ApiError(exc.code, exc.message, exc.status_code) from exc

        profile = await self.get_user_profile(user)
        if profile is not None:
            profile.name = user.full_name
            profile.sample_duration_ms = duration_ms
            profile.embedding = embedding
        else:
            profile = VoiceProfile(
                user_id=user.id,
                meeting_id=None,
                name=user.full_name,
                sample_duration_ms=duration_ms,
                embedding=embedding,
            )
            self._session.add(profile)

        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def delete_user_profile(self, user: User) -> None:
        profile = await self.get_user_profile(user)
        if profile is None:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng cá nhân.", 404)
        await self._session.delete(profile)
        await self._session.commit()

    async def enroll_meeting_guest(
        self, meeting_id: UUID, user: User, name: str, audio_bytes: bytes
    ) -> VoiceProfile:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        clean_name = name.strip()
        if not clean_name:
            raise ApiError("INVALID_NAME", "Tên người nói không được để trống.", 400)

        try:
            pcm_bytes, duration_ms = decode_audio_to_pcm16(audio_bytes)
            if duration_ms < 1000:
                raise ApiError(
                    "AUDIO_TOO_SHORT",
                    "Mẫu âm thanh quá ngắn. Vui lòng ghi âm hoặc tải lên ít nhất 1 giây giọng nói.",
                    400,
                )
            embedding = extract_embedding_from_pcm16(pcm_bytes)
        except VoiceEmbeddingError as exc:
            raise ApiError(exc.code, exc.message, exc.status_code) from exc
        profile = VoiceProfile(
            user_id=None,
            meeting_id=meeting_id,
            name=clean_name,
            sample_duration_ms=duration_ms,
            embedding=embedding,
        )
        self._session.add(profile)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def list_profiles_for_meeting(
        self, meeting_id: UUID, user: User
    ) -> list[VoiceProfile]:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        meeting = await self._session.get(Meeting, meeting_id)
        if meeting is None:
            raise ApiError("MEETING_NOT_FOUND", "Cuộc họp không tồn tại.", 404)

        # 1. Guest profiles attached directly to this meeting
        guest_profiles = list(
            await self._session.scalars(
                select(VoiceProfile)
                .where(VoiceProfile.meeting_id == meeting_id)
                .order_by(VoiceProfile.created_at)
            )
        )

        # 2. Member user profiles (owner + collaborators)
        member_user_ids = [meeting.owner_id]
        collaborator_ids = list(
            await self._session.scalars(
                select(MeetingMember.user_id).where(MeetingMember.meeting_id == meeting_id)
            )
        )
        member_user_ids.extend(collaborator_ids)

        user_profiles = list(
            await self._session.scalars(
                select(VoiceProfile).where(
                    VoiceProfile.user_id.in_(member_user_ids),
                    VoiceProfile.meeting_id.is_(None),
                )
            )
        )

        # Combine
        return guest_profiles + user_profiles

    async def list_candidates_for_matching(self, meeting_id: UUID) -> list[VoiceCandidate]:
        """Internal helper for realtime and batch diarization to fetch candidate embeddings."""
        meeting = await self._session.get(Meeting, meeting_id)
        if meeting is None:
            return []

        guest_profiles = list(
            await self._session.scalars(
                select(VoiceProfile).where(VoiceProfile.meeting_id == meeting_id)
            )
        )

        member_user_ids = [meeting.owner_id]
        collaborator_ids = list(
            await self._session.scalars(
                select(MeetingMember.user_id).where(MeetingMember.meeting_id == meeting_id)
            )
        )
        member_user_ids.extend(collaborator_ids)

        user_profiles = list(
            await self._session.scalars(
                select(VoiceProfile).where(
                    VoiceProfile.user_id.in_(member_user_ids),
                    VoiceProfile.meeting_id.is_(None),
                )
            )
        )

        all_profiles = guest_profiles + user_profiles
        return [
            VoiceCandidate(id=p.id, name=p.name, embedding=p.embedding)
            for p in all_profiles
        ]

    async def delete_meeting_guest(
        self, meeting_id: UUID, profile_id: UUID, user: User
    ) -> None:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        profile = await self._session.get(VoiceProfile, profile_id)
        if profile is None or profile.meeting_id != meeting_id:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng trong cuộc họp.", 404)
        await self._session.delete(profile)
        await self._session.commit()
