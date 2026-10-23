"""Voiceprint enrollment and meeting-scoped known-speaker selection."""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from uuid import UUID

from sqlalchemy import or_, select
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
from app.providers.storage import MediaStorage
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
        storage: MediaStorage | None = None,
    ) -> None:
        self._session = session
        self._meetings = MeetingService(session)
        self._enrollment = enrollment_provider
        self._storage = storage

    async def get_user_profile(self, user: User) -> VoiceProfile | None:
        profile = await self._session.scalar(
            select(VoiceProfile).where(
                VoiceProfile.user_id == user.id,
                VoiceProfile.meeting_id.is_(None),
            )
        )
        if profile is not None:
            is_valid = await self._verify_and_cleanup_profile(profile)
            if not is_valid:
                await self._session.commit()
                return None
        return profile

    async def enroll_user_profile(
        self, user: User, audio_bytes: bytes, filename: str | None = None
    ) -> VoiceProfile:
        profile = await self.get_user_profile(user)
        if profile is not None and profile.sample_count >= MAX_IDENTIFIERS_PER_PROFILE:
            raise _sample_limit_error()
        enrollment, wav_bytes = await self._enroll(audio_bytes, filename)
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
            await self._session.flush()
        profile.name = user.full_name
        self._append_identifiers(profile, enrollment.speaker_identifiers)
        profile.sample_duration_ms += enrollment.duration_ms
        await self._save_sample_audio(profile, wav_bytes, sample_index=profile.sample_count)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def delete_user_profile(self, user: User) -> None:
        profile = await self.get_user_profile(user)
        if profile is None:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng cá nhân.", 404)
        await self._delete_profile_audio(profile)
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
        enrollment, wav_bytes = await self._enroll(audio_bytes, filename)
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
        await self._session.flush()
        await self._save_sample_audio(profile, wav_bytes, sample_index=1)
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
        enrollment, wav_bytes = await self._enroll(audio_bytes, filename)
        new_sample_index = profile.sample_count + 1
        self._append_identifiers(profile, enrollment.speaker_identifiers)
        profile.sample_duration_ms += enrollment.duration_ms
        await self._save_sample_audio(profile, wav_bytes, sample_index=new_sample_index)
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
        await self._delete_profile_audio(profile)
        await self._session.delete(profile)
        await self._session.commit()

    async def _verify_and_cleanup_profile(self, profile: VoiceProfile) -> bool:
        """Verify profile audio files in storage. If none exist, delete profile from DB and return False.
        If some exist, adjust sample_count and return True."""
        if self._storage is None:
            return True

        existing_samples: list[int] = []
        for idx in range(1, max(2, profile.sample_count + 1)):
            key = f"voice_profiles/{profile.id}_sample_{idx}.wav"
            try:
                await self._storage.get_bytes(key)
                existing_samples.append(idx)
            except Exception:
                pass

        if not existing_samples and profile.audio_storage_path:
            try:
                await self._storage.get_bytes(profile.audio_storage_path)
                existing_samples.append(1)
            except Exception:
                pass

        if not existing_samples:
            await self._delete_profile_audio(profile)
            await self._session.delete(profile)
            return False

        real_count = len(existing_samples)
        if profile.sample_count != real_count:
            profile.sample_count = real_count
            profile.speaker_identifiers = list(profile.speaker_identifiers or [])[:real_count]

        return True

    async def list_user_profiles(self, user: User) -> list[VoiceProfile]:
        """List the user's reusable profiles and guests in meetings they own."""
        stmt = (
            select(VoiceProfile)
            .where(
                or_(
                    VoiceProfile.user_id == user.id,
                    VoiceProfile.meeting_id.in_(
                        select(Meeting.id).where(Meeting.owner_id == user.id)
                    ),
                )
            )
            .order_by(VoiceProfile.created_at.desc(), VoiceProfile.id)
        )
        profiles = list(await self._session.scalars(stmt))
        valid_profiles: list[VoiceProfile] = []
        changed = False
        for p in profiles:
            is_valid = await self._verify_and_cleanup_profile(p)
            if is_valid:
                valid_profiles.append(p)
            else:
                changed = True
        if changed:
            await self._session.commit()
        return valid_profiles

    async def create_user_speaker_profile(
        self, user: User, name: str, audio_bytes: bytes, filename: str | None = None
    ) -> VoiceProfile:
        clean_name = name.strip()
        if not clean_name:
            raise ApiError("INVALID_NAME", "Tên người nói không được để trống.", 400)
        enrollment, wav_bytes = await self._enroll(audio_bytes, filename)
        identifiers = list(enrollment.speaker_identifiers[:MAX_IDENTIFIERS_PER_PROFILE])
        profile = VoiceProfile(
            user_id=user.id,
            meeting_id=None,
            name=clean_name,
            sample_duration_ms=enrollment.duration_ms,
            speaker_identifiers=identifiers,
            provider="speechmatics",
            sample_count=len(identifiers),
        )
        self._session.add(profile)
        await self._session.flush()
        await self._save_sample_audio(profile, wav_bytes, sample_index=1)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def add_profile_sample(
        self, profile_id: UUID, user: User, audio_bytes: bytes, filename: str | None = None
    ) -> VoiceProfile:
        profile = await self._session.get(VoiceProfile, profile_id)
        if profile is None:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng.", 404)
        if profile.meeting_id:
            await self._meetings.require_access(profile.meeting_id, user, MeetingPermission.EDIT)
        elif profile.user_id != user.id:
            raise ApiError("FORBIDDEN", "Bạn không có quyền sửa hồ sơ giọng nói này.", 403)
        if profile.sample_count >= MAX_IDENTIFIERS_PER_PROFILE:
            raise _sample_limit_error()
        enrollment, wav_bytes = await self._enroll(audio_bytes, filename)
        new_sample_index = profile.sample_count + 1
        self._append_identifiers(profile, enrollment.speaker_identifiers)
        profile.sample_duration_ms += enrollment.duration_ms
        await self._save_sample_audio(profile, wav_bytes, sample_index=new_sample_index)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def delete_profile(self, profile_id: UUID, user: User) -> None:
        profile = await self._session.get(VoiceProfile, profile_id)
        if profile is None:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng.", 404)
        if profile.meeting_id:
            await self._meetings.require_access(profile.meeting_id, user, MeetingPermission.EDIT)
        elif profile.user_id != user.id:
            raise ApiError("FORBIDDEN", "Bạn không có quyền xóa hồ sơ giọng nói này.", 403)
        await self._delete_profile_audio(profile)
        await self._session.delete(profile)
        await self._session.commit()

    async def delete_profile_sample(
        self, profile_id: UUID, sample_index: int, user: User
    ) -> VoiceProfile:
        profile = await self._session.get(VoiceProfile, profile_id)
        if profile is None:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng.", 404)
        if profile.meeting_id:
            await self._meetings.require_access(profile.meeting_id, user, MeetingPermission.EDIT)
        elif profile.user_id != user.id:
            raise ApiError("FORBIDDEN", "Bạn không có quyền sửa hồ sơ giọng nói này.", 403)
        if sample_index < 1 or sample_index > profile.sample_count:
            raise ApiError("SAMPLE_NOT_FOUND", "Không tìm thấy lần thu này.", 404)

        if profile.sample_count <= 1:
            await self._delete_profile_audio(profile)
            await self._session.delete(profile)
            await self._session.commit()
            return profile

        # Read all existing sample audios before shifting
        samples_audio: list[bytes | None] = []
        if self._storage:
            for idx in range(1, profile.sample_count + 1):
                try:
                    b = await self._storage.get_bytes(f"voice_profiles/{profile.id}_sample_{idx}.wav")
                    samples_audio.append(b)
                except Exception:
                    samples_audio.append(None)

        # Delete old audio files
        await self._delete_profile_audio(profile)

        # Remove deleted sample from audio list and identifiers
        target_idx_0 = sample_index - 1
        new_audio_list = [b for i, b in enumerate(samples_audio) if i != target_idx_0]
        existing_ids = list(profile.speaker_identifiers or [])
        new_identifiers = [ident for i, ident in enumerate(existing_ids) if i != target_idx_0]

        # Re-save remaining audio files cleanly as 1, 2, ...
        if self._storage:
            for new_idx, wav_bytes in enumerate(new_audio_list, start=1):
                if wav_bytes:
                    await self._save_sample_audio(profile, wav_bytes, sample_index=new_idx)

        profile.speaker_identifiers = new_identifiers
        profile.sample_count = len(new_identifiers)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def get_profile_audio(
        self, profile_id: UUID, user: User, sample_index: int = 1
    ) -> tuple[bytes, str]:
        profile = await self._session.get(VoiceProfile, profile_id)
        if profile is None:
            raise ApiError("VOICE_PROFILE_NOT_FOUND", "Không tìm thấy mẫu giọng.", 404)
        if profile.user_id != user.id:
            if profile.meeting_id:
                await self._meetings.require_access(profile.meeting_id, user, MeetingPermission.READ)
            else:
                raise ApiError("FORBIDDEN", "Bạn không có quyền truy cập mẫu giọng này.", 403)
        if self._storage is None:
            raise ApiError("VOICE_AUDIO_NOT_FOUND", "Chưa có file âm thanh cho mẫu giọng này.", 404)

        # Try specific sample file first
        sample_key = f"voice_profiles/{profile.id}_sample_{sample_index}.wav"
        try:
            audio_bytes = await self._storage.get_bytes(sample_key)
            return audio_bytes, f"{profile.name}_mau_{sample_index}.wav"
        except Exception:
            # Fallback for sample 1 or legacy merged file
            if sample_index == 1 and profile.audio_storage_path:
                try:
                    audio_bytes = await self._storage.get_bytes(profile.audio_storage_path)
                    return audio_bytes, f"{profile.name}_mau_{sample_index}.wav"
                except Exception:
                    pass

            # If audio is not found, verify and purge broken profile from DB
            is_valid = await self._verify_and_cleanup_profile(profile)
            if not is_valid:
                await self._session.commit()
                raise ApiError("VOICE_AUDIO_NOT_FOUND", "Không tìm thấy file âm thanh và đã xóa hồ sơ hỏng khỏi hệ thống.", 404)
            raise ApiError("VOICE_AUDIO_NOT_FOUND", f"Không tìm thấy file âm thanh cho mẫu {sample_index}.", 404)

    async def _save_sample_audio(
        self, profile: VoiceProfile, wav_bytes: bytes, sample_index: int = 1
    ) -> None:
        if self._storage is None:
            return
        sample_key = f"voice_profiles/{profile.id}_sample_{sample_index}.wav"
        await self._storage.put_bytes(wav_bytes, sample_key)
        if sample_index == 1 or not profile.audio_storage_path:
            legacy_key = f"voice_profiles/{profile.id}.wav"
            await self._storage.put_bytes(wav_bytes, legacy_key)
            profile.audio_storage_path = legacy_key

    async def _delete_profile_audio(self, profile: VoiceProfile) -> None:
        if self._storage is None:
            return
        for idx in range(1, 4):
            try:
                await self._storage.delete(f"voice_profiles/{profile.id}_sample_{idx}.wav")
            except Exception:
                pass
        if profile.audio_storage_path:
            try:
                await self._storage.delete(profile.audio_storage_path)
            except Exception:
                pass

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
        # Reusable profiles belong to the owner/members of this meeting. Do not
        # send another account's newly learned voiceprints to an unrelated call.
        members = select(MeetingMember.user_id).where(MeetingMember.meeting_id == meeting_id)
        global_profiles = list(
            await self._session.scalars(
                select(VoiceProfile)
                .where(VoiceProfile.meeting_id.is_(None), or_(
                    VoiceProfile.user_id == meeting.owner_id,
                    VoiceProfile.user_id.in_(members),
                ))
                .order_by(VoiceProfile.created_at, VoiceProfile.id)
            )
        )
        seen_ids = set()
        all_profiles: list[VoiceProfile] = []
        for p in (guests + global_profiles):
            if p.id not in seen_ids:
                seen_ids.add(p.id)
                all_profiles.append(p)

        valid_profiles: list[VoiceProfile] = []
        changed = False
        for p in all_profiles:
            is_valid = await self._verify_and_cleanup_profile(p)
            if is_valid:
                valid_profiles.append(p)
            else:
                changed = True
        if changed:
            await self._session.commit()
        return valid_profiles

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
    ) -> tuple[SpeakerEnrollment, bytes]:
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
            wav_bytes = await asyncio.to_thread(normalized.read_bytes)
            try:
                enrollment = await self._enrollment.enroll_speaker(normalized, "vi")
            except STTProviderError as exc:
                raise ApiError(exc.code, str(exc), 503 if exc.retryable else 422) from exc
            return SpeakerEnrollment(enrollment.speaker_identifiers, duration_ms), wav_bytes
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


def _combine_wavs(wav1_bytes: bytes, wav2_bytes: bytes) -> bytes:
    import io
    import wave

    try:
        with wave.open(io.BytesIO(wav1_bytes), "rb") as w1:
            params1 = w1.getparams()
            frames1 = w1.readframes(w1.getnframes())
        with wave.open(io.BytesIO(wav2_bytes), "rb") as w2:
            frames2 = w2.readframes(w2.getnframes())
        out_buf = io.BytesIO()
        with wave.open(out_buf, "wb") as w_out:
            w_out.setparams(params1)
            w_out.writeframes(frames1)
            w_out.writeframes(frames2)
        return out_buf.getvalue()
    except Exception:
        return wav2_bytes

