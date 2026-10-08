"""Voiceprint enrollment and meeting-scoped known-speaker selection."""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.models.enums import MeetingPermission
from app.models.meeting import Meeting, MeetingMember
from app.models.user import User
from app.models.voice_profile import VoiceProfile
from app.providers.contracts import (
    KnownSpeaker,
    SpeakerEnrollment,
    SpeakerEnrollmentProvider,
    STTProviderError,
)
from app.services.meetings import MeetingService

MIN_SAMPLE_MS = 10_000
MAX_SAMPLE_MS = 25_000
MAX_IDENTIFIERS_PER_PROFILE = 3
MAX_SESSION_IDENTIFIERS = 50


class VoiceProfileService:
    def __init__(
        self,
        session: AsyncSession,
        enrollment_provider: SpeakerEnrollmentProvider | None = None,
    ) -> None:
        self._session = session
        self._meetings = MeetingService(session)
        self._enrollment = enrollment_provider

    async def get_user_profile(self, user: User) -> VoiceProfile | None:
        return await self._session.scalar(
            select(VoiceProfile).where(
                VoiceProfile.user_id == user.id,
                VoiceProfile.meeting_id.is_(None),
            )
        )

    async def enroll_user_profile(
        self, user: User, audio_bytes: bytes, filename: str | None = None
    ) -> VoiceProfile:
        profile = await self.get_user_profile(user)
        if profile is not None and profile.sample_count >= MAX_IDENTIFIERS_PER_PROFILE:
            raise _sample_limit_error()
        enrollment = await self._enroll(audio_bytes, filename)
        if profile is None:
            profile = VoiceProfile(
                user_id=user.id,
                meeting_id=None,
                name=user.full_name,
                sample_duration_ms=0,
                speaker_identifiers=[],
                provider="speechmatics",
                sample_count=0,
            )
            self._session.add(profile)
        profile.name = user.full_name
        self._append_identifiers(profile, enrollment.speaker_identifiers)
        profile.sample_duration_ms += enrollment.duration_ms
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
        self,
        meeting_id: UUID,
        user: User,
        name: str,
        audio_bytes: bytes,
        filename: str | None = None,
    ) -> VoiceProfile:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        clean_name = name.strip()
        if not clean_name:
            raise ApiError("INVALID_NAME", "Tên người nói không được để trống.", 400)
        enrollment = await self._enroll(audio_bytes, filename)
        identifiers = list(enrollment.speaker_identifiers[:MAX_IDENTIFIERS_PER_PROFILE])
        profile = VoiceProfile(
            user_id=None,
            meeting_id=meeting_id,
            name=clean_name,
            sample_duration_ms=enrollment.duration_ms,
            speaker_identifiers=identifiers,
            provider="speechmatics",
            sample_count=len(identifiers),
        )
        self._session.add(profile)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def add_meeting_guest_sample(
        self,
        meeting_id: UUID,
        profile_id: UUID,
        user: User,
        audio_bytes: bytes,
        filename: str | None = None,
    ) -> VoiceProfile:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        profile = await self._meeting_guest(meeting_id, profile_id)
        if profile.sample_count >= MAX_IDENTIFIERS_PER_PROFILE:
            raise _sample_limit_error()
        enrollment = await self._enroll(audio_bytes, filename)
        self._append_identifiers(profile, enrollment.speaker_identifiers)
        profile.sample_duration_ms += enrollment.duration_ms
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def list_profiles_for_meeting(
        self, meeting_id: UUID, user: User
    ) -> list[VoiceProfile]:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.READ)
        profiles = await self._profiles_for_meeting(meeting_id)
        if profiles is None:
            raise ApiError("MEETING_NOT_FOUND", "Cuộc họp không tồn tại.", 404)
        return profiles

    async def list_known_speakers(self, meeting_id: UUID) -> tuple[KnownSpeaker, ...]:
        profiles = await self._profiles_for_meeting(meeting_id)
        if not profiles:
            return ()
        profiles = [profile for profile in profiles if profile.speaker_identifiers]
        if len(profiles) > MAX_SESSION_IDENTIFIERS:
            raise ApiError(
                "VOICE_PROFILE_LIMIT_EXCEEDED",
                "Cuộc họp có hơn 50 hồ sơ giọng nói; không thể mở phiên nhận diện.",
                409,
            )
        allocated: dict[UUID, list[str]] = {profile.id: [] for profile in profiles}
        remaining = MAX_SESSION_IDENTIFIERS
        # Allocate round-robin so each person receives one identifier first.
        for index in range(MAX_IDENTIFIERS_PER_PROFILE):
            for profile in profiles:
                identifiers = profile.speaker_identifiers[:MAX_IDENTIFIERS_PER_PROFILE]
                if index < len(identifiers) and remaining:
                    allocated[profile.id].append(str(identifiers[index]))
                    remaining -= 1
            if not remaining:
                break
        return tuple(
            KnownSpeaker(
                profile_id=profile.id,
                provider_label=f"VP_{profile.id.hex}",
                name=profile.name,
                speaker_identifiers=tuple(allocated[profile.id]),
            )
            for profile in profiles
            if allocated[profile.id]
        )

    async def delete_meeting_guest(
        self, meeting_id: UUID, profile_id: UUID, user: User
    ) -> None:
        await self._meetings.require_access(meeting_id, user, MeetingPermission.EDIT)
        profile = await self._meeting_guest(meeting_id, profile_id)
        await self._session.delete(profile)
        await self._session.commit()

    async def _profiles_for_meeting(self, meeting_id: UUID) -> list[VoiceProfile] | None:
        meeting = await self._session.get(Meeting, meeting_id)
        if meeting is None:
            return None
        guests = list(
            await self._session.scalars(
                select(VoiceProfile)
                .where(VoiceProfile.meeting_id == meeting_id)
                .order_by(VoiceProfile.created_at, VoiceProfile.id)
            )
        )
        member_user_ids = [meeting.owner_id]
        member_user_ids.extend(
            list(
                await self._session.scalars(
                    select(MeetingMember.user_id).where(
                        MeetingMember.meeting_id == meeting_id
                    )
                )
            )
        )
        users = list(
            await self._session.scalars(
                select(VoiceProfile)
                .where(
                    VoiceProfile.user_id.in_(member_user_ids),
                    VoiceProfile.meeting_id.is_(None),
                )
                .order_by(VoiceProfile.created_at, VoiceProfile.id)
            )
        )
        return guests + users

    async def _meeting_guest(self, meeting_id: UUID, profile_id: UUID) -> VoiceProfile:
        profile = await self._session.get(VoiceProfile, profile_id)
        if profile is None or profile.meeting_id != meeting_id:
            raise ApiError(
                "VOICE_PROFILE_NOT_FOUND",
                "Không tìm thấy mẫu giọng trong cuộc họp.",
                404,
            )
        return profile

    async def _enroll(
        self, audio_bytes: bytes, filename: str | None
    ) -> SpeakerEnrollment:
        if self._enrollment is None:
            raise ApiError(
                "PROVIDER_CAPABILITY_UNAVAILABLE",
                "Speechmatics speaker enrollment is not configured.",
                503,
            )
        normalized = await _normalize_sample(audio_bytes, filename)
        try:
            duration_ms = await asyncio.to_thread(_wav_duration_ms, normalized)
            if duration_ms < MIN_SAMPLE_MS:
                raise ApiError(
                    "VOICE_PROFILE_AUDIO_TOO_SHORT",
                    "Mẫu giọng phải dài ít nhất 10 giây.",
                    422,
                )
            if duration_ms > MAX_SAMPLE_MS:
                raise ApiError(
                    "VOICE_PROFILE_AUDIO_TOO_LONG",
                    "Mẫu giọng không được dài quá 25 giây.",
                    422,
                )
            try:
                enrollment = await self._enrollment.enroll_speaker(normalized, "vi")
            except STTProviderError as exc:
                raise ApiError(exc.code, str(exc), 503 if exc.retryable else 422) from exc
            return SpeakerEnrollment(enrollment.speaker_identifiers, duration_ms)
        finally:
            await asyncio.to_thread(normalized.unlink, missing_ok=True)

    @staticmethod
    def _append_identifiers(profile: VoiceProfile, values: tuple[str, ...]) -> None:
        existing = list(profile.speaker_identifiers or [])
        original_count = len(existing)
        for identifier in values:
            if identifier not in existing:
                existing.append(identifier)
            if len(existing) >= MAX_IDENTIFIERS_PER_PROFILE:
                break
        if len(existing) == original_count:
            raise ApiError(
                "VOICE_PROFILE_DUPLICATE_SAMPLE",
                "Mẫu giọng không tạo ra identifier mới.",
                409,
            )
        profile.speaker_identifiers = existing
        profile.sample_count = len(existing)


async def _normalize_sample(audio_bytes: bytes, filename: str | None) -> Path:
    suffix = Path(filename or "sample.webm").suffix or ".webm"
    source_fd, source_name = tempfile.mkstemp(prefix="voice-source-", suffix=suffix)
    output_fd, output_name = tempfile.mkstemp(prefix="voice-normalized-", suffix=".wav")
    source, output = Path(source_name), Path(output_name)
    os.close(source_fd)
    os.close(output_fd)
    try:
        await asyncio.to_thread(source.write_bytes, audio_bytes)
        process = await asyncio.to_thread(
            subprocess.run,
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(output),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode != 0 or output.stat().st_size <= 44:
            raise ApiError(
                "VOICE_PROFILE_AUDIO_INVALID",
                "Không thể đọc file âm thanh mẫu.",
                422,
            )
        return output
    except FileNotFoundError as exc:
        raise ApiError(
            "MEDIA_TOOL_UNAVAILABLE", "FFmpeg chưa được cài đặt trên máy chủ.", 503
        ) from exc
    finally:
        source.unlink(missing_ok=True)
        if not output.exists() or output.stat().st_size <= 44:
            output.unlink(missing_ok=True)


def _wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as stream:
        return round(stream.getnframes() * 1000 / stream.getframerate())


def _sample_limit_error() -> ApiError:
    return ApiError(
        "VOICE_PROFILE_SAMPLE_LIMIT",
        "Hồ sơ đã có đủ 3 mẫu; hãy xóa và đăng ký lại nếu muốn thay đổi.",
        409,
    )
