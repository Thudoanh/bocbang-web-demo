import asyncio
import io
import wave
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import ApiError
from app.db.base import Base
from app.models.enums import MeetingSourceType
from app.models.meeting import Meeting
from app.models.user import User
from app.providers.contracts import SpeakerEnrollment, STTProviderError
from app.schemas.voice_profile import VoiceProfileResponse
from app.services.voice_profiles import VoiceProfileService


def wav_bytes(duration_seconds: float) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(b"\x01\x00" * round(16000 * duration_seconds))
    return output.getvalue()


class FakeEnrollmentProvider:
    def __init__(self, errors: list[STTProviderError] | None = None) -> None:
        self.calls = 0
        self.errors = errors or []

    async def enroll_speaker(self, source: Path, language: str = "vi") -> SpeakerEnrollment:
        assert source.is_file()
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return SpeakerEnrollment((f"opaque-{self.calls}",), 10_000)


async def setup_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection: object, _: object) -> None:
        connection.execute("PRAGMA foreign_keys=ON")  # type: ignore[union-attr]

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory


def test_profile_accumulates_three_identifiers_and_hides_them_from_response() -> None:
    async def scenario() -> None:
        engine, factory = await setup_session()
        try:
            async with factory() as session:
                user = User(
                    email="owner@example.com",
                    full_name="Trần Văn Owner",
                    is_email_verified=True,
                )
                session.add(user)
                await session.commit()
                provider = FakeEnrollmentProvider()
                service = VoiceProfileService(session, provider)
                for expected in range(1, 4):
                    profile = await service.enroll_user_profile(
                        user, wav_bytes(10), "sample.wav"
                    )
                    assert profile.sample_count == expected
                    assert len(profile.speaker_identifiers) == expected
                with pytest.raises(ApiError) as caught:
                    await service.enroll_user_profile(user, wav_bytes(10), "sample.wav")
                assert caught.value.code == "VOICE_PROFILE_SAMPLE_LIMIT"
                payload = VoiceProfileResponse.model_validate(profile).model_dump()
                assert "speaker_identifiers" not in payload
                assert "opaque-1" not in repr(payload)
        finally:
            await engine.dispose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("duration", "code"),
    [(9.9, "VOICE_PROFILE_AUDIO_TOO_SHORT"), (25.1, "VOICE_PROFILE_AUDIO_TOO_LONG")],
)
def test_profile_rejects_audio_outside_duration_window(
    duration: float, code: str
) -> None:
    async def scenario() -> None:
        engine, factory = await setup_session()
        try:
            async with factory() as session:
                user = User(
                    email="duration@example.com", full_name="Duration", is_email_verified=True
                )
                session.add(user)
                await session.commit()
                provider = FakeEnrollmentProvider()
                with pytest.raises(ApiError) as caught:
                    await VoiceProfileService(session, provider).enroll_user_profile(
                        user, wav_bytes(duration), "sample.wav"
                    )
                assert caught.value.code == code
                assert provider.calls == 0
        finally:
            await engine.dispose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "provider_code", ["VOICE_PROFILE_NO_SPEECH", "VOICE_PROFILE_MULTIPLE_SPEAKERS"]
)
def test_profile_rejects_invalid_speaker_sample(provider_code: str) -> None:
    async def scenario() -> None:
        engine, factory = await setup_session()
        try:
            async with factory() as session:
                user = User(
                    email=f"{provider_code.lower()}@example.com",
                    full_name="Invalid",
                    is_email_verified=True,
                )
                session.add(user)
                await session.commit()
                provider = FakeEnrollmentProvider(
                    [STTProviderError("invalid sample", code=provider_code, retryable=False)]
                )
                with pytest.raises(ApiError) as caught:
                    await VoiceProfileService(session, provider).enroll_user_profile(
                        user, wav_bytes(10), "sample.wav"
                    )
                assert caught.value.code == provider_code
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_known_speakers_include_owner_and_guest_with_opaque_labels() -> None:
    async def scenario() -> None:
        engine, factory = await setup_session()
        try:
            async with factory() as session:
                owner = User(
                    email="meeting-owner@example.com",
                    full_name="Huy",
                    is_email_verified=True,
                )
                session.add(owner)
                await session.commit()
                meeting = Meeting(
                    owner=owner,
                    title="Known speakers",
                    source_type=MeetingSourceType.REALTIME,
                    language_mode="vi",
                    diarization_enabled=True,
                )
                session.add(meeting)
                await session.commit()
                provider = FakeEnrollmentProvider()
                service = VoiceProfileService(session, provider)
                personal = await service.enroll_user_profile(owner, wav_bytes(10), "huy.wav")
                guest = await service.enroll_meeting_guest(
                    meeting.id, owner, "Minh", wav_bytes(10), "minh.wav"
                )
                known = await service.list_known_speakers(meeting.id)
                assert {item.name for item in known} == {"Huy", "Minh"}
                assert {item.profile_id for item in known} == {personal.id, guest.id}
                assert all(item.provider_label == f"VP_{item.profile_id.hex}" for item in known)
                assert all(len(item.speaker_identifiers) == 1 for item in known)
        finally:
            await engine.dispose()

    asyncio.run(scenario())
