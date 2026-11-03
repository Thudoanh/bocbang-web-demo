import asyncio
from pathlib import Path
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.db.base import Base
from app.db.session import Database
from app.models.enums import JobStatus, MeetingSourceType, MeetingStatus
from app.models.media import Job, MediaFile
from app.models.meeting import Meeting
from app.models.transcript import CurrentSegment, Speaker
from app.models.user import User
from app.providers.contracts import STTCapabilities, STTProviderError, TranscriptionResult, TranscriptionSegment
from app.providers.storage import LocalStorageBackend
from app.services.media_worker import MediaProcessingWorker
from app.services.transcripts import TranscriptService
from app.schemas.transcript import SegmentEditRequest


async def seed(tmp_path):
    url = f"sqlite+aiosqlite:///{(tmp_path/'worker.sqlite3').as_posix()}"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    db = Database(url)
    async with db.session() as session:
        user = User(email="worker@example.com", full_name="Test", is_email_verified=True)
        session.add(user)
        await session.flush()
        meeting = Meeting(owner_id=user.id, title="Upload", source_type=MeetingSourceType.UPLOAD,
            language_mode="auto", diarization_enabled=True)
        session.add(meeting)
        await session.flush()
        media = MediaFile(meeting_id=meeting.id, original_filename="meeting.wav", mime_type="audio/wav",
            size_bytes=12, duration_ms=4000, storage_key="original.wav", normalized_storage_key="normalized.wav", status="uploaded")
        session.add(media)
        await session.flush()
        job = Job(meeting_id=meeting.id, media_file_id=media.id, job_type="media_processing", status=JobStatus.QUEUED)
        session.add(job)
        await session.commit()
        ids = meeting.id, job.id
    storage = LocalStorageBackend(tmp_path/'objects')
    await storage.put_bytes(b"original wav", "original.wav")
    await storage.put_bytes(b"test audio", "normalized.wav")
    return db, storage, ids


def test_upload_uses_configured_provider_even_with_groq_key_and_preserves_brief_turns(tmp_path, monkeypatch):
    async def scenario():
        db, storage, (mid, jid) = await seed(tmp_path)

        class Provider:
            def capabilities(self):
                return STTCapabilities(True, False, True, True, True, frozenset({"vi", "en"}), True)

            async def transcribe_file(self, source, language, known_speakers):
                self.calls.append(language)
                self.source = source
                assert source.is_file()
                # A short, overlapping reply must remain a separate speaker.
                return TranscriptionResult("vi", (
                    TranscriptionSegment(0, 1000, "Bạn đồng ý với đề xuất này?", "speaker_1"),
                    TranscriptionSegment(900, 1300, "Dạ.", "speaker_2"),
                    TranscriptionSegment(1400, 3000, "Vậy chúng ta thống nhất.", "speaker_1"),
                ), provider_name="speechmatics")

        async def no_translation(*args):
            pass

        monkeypatch.setattr(MediaProcessingWorker, "_background_auto_translate", no_translation)
        provider = Provider()
        provider.calls = []
        try:
            settings = Settings(_env_file=None, groq_api_key="test-groq-key", media_storage_path=tmp_path)
            assert await MediaProcessingWorker(db, storage, provider, settings).run(jid) is False
            assert provider.calls == ["auto"]
            assert not provider.source.exists()
            async with db.session() as session:
                meeting = await session.get(Meeting, mid)
                job = await session.get(Job, jid)
                assert meeting.status == MeetingStatus.COMPLETED and meeting.language_mode == "vi"
                assert job.status == JobStatus.COMPLETED
                assert job.payload["stt_provider"] == "speechmatics"
                assert set(job.payload["processing_timings_ms"]) == {"source_preparation_ms", "normalization_ms", "transcription_ms", "persistence_ms", "total_ms"}
                rows = list(await session.scalars(select(CurrentSegment).order_by(CurrentSegment.position)))
                assert [r.text for r in rows] == ["Bạn đồng ý với đề xuất này?", "Dạ.", "Vậy chúng ta thống nhất."]
                assert rows[0].speaker_id == rows[2].speaker_id != rows[1].speaker_id
                assert rows[0].speaker_id is not None and rows[1].speaker_id is not None
                assert len(list(await session.scalars(select(Speaker)))) == 2
                user = await session.get(User, meeting.owner_id)
                changed = await TranscriptService(session).edit_segment(
                    rows[1].logical_segment_id, user, SegmentEditRequest(text="Vâng.", start_ms=900, end_ms=1300))
                assert changed.segment.text == "Vâng."
                assert changed.segment.speaker_id == rows[1].speaker_id
        finally:
            await db.dispose()

    asyncio.run(scenario())


@pytest.mark.parametrize("filename", ["original.m4a", "original.mp4", "original.wav"])
@pytest.mark.parametrize("with_cached_wav", [False, True])
def test_original_upload_is_submitted_unchanged_even_with_cached_wav(tmp_path, monkeypatch, filename, with_cached_wav):
    async def scenario():
        db, storage, (mid, jid) = await seed(tmp_path)
        async with db.session() as session:
            job = await session.get(Job, jid)
            media = await session.get(MediaFile, job.media_file_id)
            media.original_filename = filename
            media.storage_key = filename
            media.normalized_storage_key = "normalized.wav" if with_cached_wav else None
            media.size_bytes = len(b"original-compressed-audio")
            await session.commit()
        await storage.put_bytes(b"original-compressed-audio", filename)

        class Provider:
            def capabilities(self):
                return STTCapabilities(True, False, True, True, True, frozenset({"vi", "en"}), True)

            async def transcribe_file(self, source, language, known):
                self.source = source
                assert source.suffix == Path(filename).suffix
                assert source.read_bytes() == b"original-compressed-audio"
                return TranscriptionResult("vi", (TranscriptionSegment(0, 1000, "Xin chào", "S1"),),
                    provider_name="speechmatics", provider_metadata={"model":"enhanced", "submit_ms":10, "wait_ms":20})

        async def no_translation(*args):
            pass

        monkeypatch.setattr(MediaProcessingWorker, "_background_auto_translate", no_translation)
        provider = Provider()
        try:
            assert await MediaProcessingWorker(db, storage, provider, Settings(_env_file=None)).run(jid) is False
            assert not provider.source.exists()
            async with db.session() as session:
                job = await session.get(Job, jid)
                assert job.status == JobStatus.COMPLETED
                media = await session.get(MediaFile, job.media_file_id)
                assert media.normalized_storage_key == ("normalized.wav" if with_cached_wav else None)
                assert job.payload["stt_input"] == {"format":Path(filename).suffix, "bytes":len(b"original-compressed-audio"), "original_bytes":len(b"original-compressed-audio"), "native":True}
                assert job.payload["stt_details"]["model"] == "enhanced"
                assert job.payload["processing_timings_ms"]["normalization_ms"] == 0
                assert await storage.get_bytes(filename) == b"original-compressed-audio"
                assert await storage.get_bytes("normalized.wav") == b"test audio"
        finally:
            await db.dispose()

    asyncio.run(scenario())


def test_fallback_native_formats_require_support_from_both_adapters():
    from types import SimpleNamespace
    from app.providers.stt import FallbackSTTProvider
    primary = SimpleNamespace(batch_input_formats=frozenset({".wav", ".m4a"}))
    secondary = SimpleNamespace(batch_input_formats=frozenset({".wav"}))
    assert FallbackSTTProvider(primary, secondary).batch_input_formats == frozenset({".wav"})


def test_provider_failure_keeps_error_and_never_retries_an_arbitrary_language(tmp_path):
    async def scenario():
        db, storage, (mid, jid) = await seed(tmp_path)

        class Provider:
            def capabilities(self):
                return STTCapabilities(True, False, True, True, True, frozenset({"vi", "en"}), True)

            async def transcribe_file(self, source, language, known_speakers):
                self.calls.append(language)
                raise STTProviderError("Invalid configuration", code="STT_PROVIDER_CONFIGURATION_ERROR", retryable=False)

        provider = Provider()
        provider.calls = []
        try:
            settings = Settings(_env_file=None, groq_api_key="test-key", media_storage_path=tmp_path)
            assert await MediaProcessingWorker(db, storage, provider, settings).run(jid) is False
            assert provider.calls == ["auto"]
            async with db.session() as session:
                job = await session.get(Job, jid)
                assert job.status == JobStatus.FAILED
                assert job.error_code == "STT_PROVIDER_CONFIGURATION_ERROR"
                assert job.error_retryable is False
                assert (await session.get(Meeting, mid)).language_mode == "auto"
        finally:
            await db.dispose()

    asyncio.run(scenario())
