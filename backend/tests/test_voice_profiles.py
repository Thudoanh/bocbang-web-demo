import asyncio
import io
import wave
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import numpy as np
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.enums import MeetingPermission, MeetingSourceType, MeetingStatus
from app.models.meeting import Meeting, MeetingMember
from app.models.transcript import Speaker
from app.models.user import User
from app.models.voice_profile import VoiceProfile
from app.providers.contracts import TranscriptionSegment
from app.services.realtime import RealtimeTranscriptService
from app.services.voice_embedding import (
    VoiceCandidate,
    compute_similarity,
    extract_embedding_from_pcm16,
    match_candidate,
)
from app.services.voice_profiles import VoiceProfileService


def _generate_synthetic_wav(freq: float, duration_sec: float = 1.5, sample_rate: int = 16000) -> bytes:
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), False)
    samples = (np.sin(2 * np.pi * freq * t) * 30000).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(samples.tobytes())
    return buf.getvalue()


def test_feature_extraction_and_matching() -> None:
    wav_a1 = _generate_synthetic_wav(440.0, 1.5)
    wav_a2 = _generate_synthetic_wav(440.0, 2.0)
    wav_b = _generate_synthetic_wav(880.0, 1.5)

    pcm_a1 = wav_a1[44:]  # Skip WAV header
    pcm_a2 = wav_a2[44:]
    pcm_b = wav_b[44:]

    emb_a1 = extract_embedding_from_pcm16(pcm_a1)
    emb_a2 = extract_embedding_from_pcm16(pcm_a2)
    emb_b = extract_embedding_from_pcm16(pcm_b)

    assert len(emb_a1) == 192
    assert len(emb_a2) == 192
    assert len(emb_b) == 192

    # Verify unit norm
    assert np.isclose(np.linalg.norm(emb_a1), 1.0, atol=1e-3)

    sim_same = compute_similarity(emb_a1, emb_a2)
    sim_diff = compute_similarity(emb_a1, emb_b)

    assert sim_same > 0.90
    assert sim_diff < 0.75

    candidate_a = VoiceCandidate(id=uuid4(), name="Alice", embedding=emb_a1)
    candidate_b = VoiceCandidate(id=uuid4(), name="Bob", embedding=emb_b)

    # Match test
    match, conf = match_candidate(emb_a2, [candidate_a, candidate_b], threshold=0.75)
    assert match is not None
    assert match.name == "Alice"
    assert conf > 0.90


def test_voice_profile_service_flow() -> None:
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")

        @event.listens_for(engine.sync_engine, "connect")
        def enable_foreign_keys(connection: object, _: object) -> None:
            connection.execute("PRAGMA foreign_keys=ON")  # type: ignore[union-attr]

        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            owner = User(email="owner@example.com", full_name="Trần Văn Owner", is_email_verified=True)
            guest_user = User(email="guest@example.com", full_name="Lê Thị Guest", is_email_verified=True)
            session.add_all([owner, guest_user])
            await session.commit()
            await session.refresh(owner)
            await session.refresh(guest_user)

            service = VoiceProfileService(session)

            # 1. Enroll user profile
            audio_owner = _generate_synthetic_wav(300.0, 1.5)
            profile_owner = await service.enroll_user_profile(owner, audio_owner)
            assert profile_owner.name == "Trần Văn Owner"
            assert profile_owner.sample_duration_ms >= 1000
            assert len(profile_owner.embedding) == 192

            # 2. Create meeting
            meeting = Meeting(
                owner=owner,
                title="Bóc Băng AI Meeting",
                source_type=MeetingSourceType.REALTIME,
                language_mode="vi",
                diarization_enabled=True,
            )
            session.add(meeting)
            await session.commit()
            await session.refresh(meeting)

            # 3. Add guest user as meeting member
            member = MeetingMember(meeting=meeting, user=guest_user, permission=MeetingPermission.EDIT)
            session.add(member)
            await session.commit()

            # 4. Enroll meeting guest (unregistered participant)
            audio_guest = _generate_synthetic_wav(600.0, 2.0)
            guest_profile = await service.enroll_meeting_guest(
                meeting.id, owner, "Khách Mời A", audio_guest
            )
            assert guest_profile.name == "Khách Mời A"
            assert guest_profile.meeting_id == meeting.id

            # 5. List candidates for meeting
            candidates = await service.list_candidates_for_matching(meeting.id)
            candidate_names = {c.name for c in candidates}
            assert "Trần Văn Owner" in candidate_names
            assert "Khách Mời A" in candidate_names

            # 6. Delete meeting guest
            await service.delete_meeting_guest(meeting.id, guest_profile.id, owner)
            candidates_after = await service.list_candidates_for_matching(meeting.id)
            assert "Khách Mời A" not in {c.name for c in candidates_after}

    asyncio.run(scenario())


def test_realtime_speaker_matching_with_voice_profile() -> None:
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")

        @event.listens_for(engine.sync_engine, "connect")
        def enable_foreign_keys(connection: object, _: object) -> None:
            connection.execute("PRAGMA foreign_keys=ON")  # type: ignore[union-attr]

        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            user = User(email="speaker@example.com", full_name="Nguyễn Văn A", is_email_verified=True)
            session.add(user)
            await session.commit()
            await session.refresh(user)

            meeting = Meeting(
                owner=user,
                title="Voice Identification Test",
                source_type=MeetingSourceType.REALTIME,
                language_mode="vi",
                diarization_enabled=True,
                status=MeetingStatus.CREATED,
            )
            session.add(meeting)
            await session.commit()
            await session.refresh(meeting)

            # Generate synthetic voice for Nguyễn Văn A at 500 Hz
            wav_sample = _generate_synthetic_wav(500.0, 2.0)
            pcm_sample = wav_sample[44:]
            embedding = extract_embedding_from_pcm16(pcm_sample)

            candidate = VoiceCandidate(id=uuid4(), name="Nguyễn Văn A", embedding=embedding)

            realtime_service = RealtimeTranscriptService(
                session, meeting, user.id, candidates=[candidate]
            )
            await realtime_service.recording_started()

            # Feed matching audio
            realtime_service.feed_audio(pcm_sample)

            # Persist final STT turn
            segment = TranscriptionSegment(
                start_ms=0,
                end_ms=2000,
                text="Xin chào các bạn tôi là Nguyễn Văn A.",
                speaker_label="speaker_0",
            )
            stored = await realtime_service.persist_final(segment, turn_order=1)

            assert stored.speaker_id is not None
            speaker = await realtime_service.get_speaker(stored.speaker_id)
            assert speaker is not None
            assert speaker.name == "Nguyễn Văn A"
            assert speaker.is_identified is True
            assert speaker.match_confidence is not None
            assert speaker.match_confidence > 0.85

    asyncio.run(scenario())


if __name__ == "__main__":
    test_feature_extraction_and_matching()
    print("Test 1: feature extraction & cosine similarity OK")
    test_voice_profile_service_flow()
    print("Test 2: voice profile service flow OK")
    test_realtime_speaker_matching_with_voice_profile()
    print("Test 3: realtime speaker matching OK")
    print("ALL TESTS PASSED SUCCESSFULLY!")
