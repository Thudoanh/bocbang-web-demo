"""Regression coverage for cancelled upload translation and source echoes."""
import asyncio
from uuid import UUID

import httpx
import pytest
from sqlalchemy import select

from app.core.config import Settings
from app.db.session import Database
from app.models.enums import JobStatus, MeetingStatus
from app.models.media import Job
from app.models.meeting import Meeting
from app.models.translation import Translation, TranslationSegment
from app.models.user import User
from app.providers.contracts import (
    LLMProviderError, STTCapabilities, TranscriptionResult, TranscriptionSegment,
    TranslationCapabilities, TranslationProviderError,
)
from app.providers.groq import GroqTranslationProvider
from app.providers.translation import FallbackTranslationProvider, build_translation_provider, translation_provider_registry
from app.providers.translation_validation import validate_translation
from app.schemas.ai import TranslationCreateRequest
from app.services.ai import AIJobDispatcher, AIService
from app.services.media_worker import MediaProcessingWorker
from app.workers.reconciler import pending_job_ids
from test_media_worker_batch import seed


class STT:
    def capabilities(self):
        return STTCapabilities(True, False, True, True, True, frozenset({"vi", "en"}), True)

    async def transcribe_file(self, *_args):
        return TranscriptionResult("vi", (TranscriptionSegment(0, 1000, "Xin chào mọi người", "S1"),), provider_name="speechmatics")


class Translator:
    def __init__(self, result="Hello everyone"):
        self.result = result
        self.calls = []

    def capabilities(self):
        return TranslationCapabilities(frozenset({("vi", "en"), ("en", "vi")}))

    async def translate_segments(self, segments, source, target):
        self.calls.append((segments, source, target))
        if isinstance(self.result, Exception):
            raise self.result
        if self.result == "short":
            return ()
        return tuple(TranscriptionSegment(s.start_ms, s.end_ms, s.text if self.result == "echo" else self.result) for s in segments)


def test_upload_translation_survives_loop_exit_and_queue_failure(tmp_path, monkeypatch):
    def unavailable(*_args):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr("app.workers.broker.enqueue_job", unavailable)

    async def upload():
        db, storage, (mid, jid) = await seed(tmp_path)
        try:
            assert await MediaProcessingWorker(db, storage, STT(), Settings(_env_file=None)).run(jid) is False
            async with db.session() as session:
                stt = await session.get(Job, jid)
                tid = UUID(stt.payload["translation_job_id"])
                child = await session.get(Job, tid)
                assert stt.status == JobStatus.COMPLETED and child.status == JobStatus.QUEUED
                assert child.payload["source_language"] == "vi" and child.payload["target_language"] == "en"
                assert tid in await pending_job_ids(db, 100)
                # The UI reuses the pending upload translation instead of adding another job.
                meeting = await session.get(Meeting, mid)
                owner = await session.get(User, meeting.owner_id)
                requested = await AIService(session, Translator(), None).request_translation(
                    mid, owner, TranslationCreateRequest(source_language="vi", target_language="en"))
                assert requested.id == tid
                assert len(list(await session.scalars(select(Job).where(Job.job_type == "translation")))) == 1
            return mid, jid, tid, storage
        finally:
            await db.dispose()

    mid, jid, tid, storage = asyncio.run(upload())
    # A new event loop represents a different durable worker execution.
    async def translate():
        db = Database(f"sqlite+aiosqlite:///{(tmp_path/'worker.sqlite3').as_posix()}")
        translator = Translator()
        try:
            worker = AIJobDispatcher(db, Settings(_env_file=None), translator, None, storage)
            assert await worker.run(tid) is False
            assert await worker.run(tid) is False  # duplicate queue delivery is a no-op
            async with db.session() as session:
                assert (await session.get(Job, jid)).status == JobStatus.COMPLETED
                assert (await session.get(Job, tid)).status == JobStatus.COMPLETED
                assert (await session.get(Meeting, mid)).status == MeetingStatus.COMPLETED
                assert [s.text for s in await session.scalars(select(TranslationSegment))] == ["Hello everyone"]
                assert len(list(await session.scalars(select(Translation)))) == 1
            assert len(translator.calls) == 1
        finally:
            await db.dispose()
    asyncio.run(translate())


@pytest.mark.parametrize("bad", ["echo", "", "short", TranslationProviderError("temporary failure")])
def test_failed_translation_is_retryable_and_never_saves_source(tmp_path, monkeypatch, bad):
    monkeypatch.setattr("app.workers.broker.enqueue_job", lambda *_args: None)
    async def scenario():
        db, storage, (mid, jid) = await seed(tmp_path)
        try:
            settings = Settings(_env_file=None)
            await MediaProcessingWorker(db, storage, STT(), settings).run(jid)
            async with db.session() as session:
                tid = UUID((await session.get(Job, jid)).payload["translation_job_id"])
            assert await AIJobDispatcher(db, settings, Translator(bad), None, storage).run(tid) is True
            async with db.session() as session:
                assert (await session.get(Job, tid)).status == JobStatus.RETRYING
                assert (await session.get(Job, jid)).status == JobStatus.COMPLETED
                assert not list(await session.scalars(select(Translation)))
                assert not list(await session.scalars(select(TranslationSegment)))
            # A later successful delivery repairs the translation without re-running STT.
            assert await AIJobDispatcher(db, settings, Translator(), None, storage).run(tid) is False
            async with db.session() as session:
                assert [s.text for s in await session.scalars(select(TranslationSegment))] == ["Hello everyone"]
        finally:
            await db.dispose()
    asyncio.run(scenario())


@pytest.mark.parametrize("bad", ["echo", "", "short", TranslationProviderError("unavailable")])
def test_fallback_handles_invalid_success_as_well_as_errors(bad):
    primary, fallback = Translator(bad), Translator()
    source = (TranscriptionSegment(0, 1000, "Xin chào mọi người"),)
    result = asyncio.run(FallbackTranslationProvider(primary, fallback).translate_segments(source, "vi", "en"))
    assert result[0].text == "Hello everyone" and len(fallback.calls) == 1


def test_configured_fallback_runs_before_google(monkeypatch):
    primary, secondary, google = Translator("echo"), Translator(), Translator("unused")
    monkeypatch.setitem(translation_provider_registry._factories, "primary-test", lambda _s: primary)
    monkeypatch.setitem(translation_provider_registry._factories, "secondary-test", lambda _s: secondary)
    monkeypatch.setattr("app.providers.translation.GoogleTranslateProvider", lambda: google)
    provider = build_translation_provider(Settings(_env_file=None, translation_provider="primary-test", translation_fallback_provider="secondary-test"))
    result = asyncio.run(provider.translate_segments((TranscriptionSegment(0, 1, "Xin chào mọi người"),), "vi", "en"))
    assert result[0].text == "Hello everyone" and not google.calls


def test_missing_optional_fallback_credentials_keep_google_available(monkeypatch):
    primary, google = Translator("echo"), Translator()
    def missing(_settings):
        raise ValueError("Optional provider is not configured")
    monkeypatch.setitem(translation_provider_registry._factories, "primary-test", lambda _s: primary)
    monkeypatch.setitem(translation_provider_registry._factories, "missing-test", missing)
    monkeypatch.setattr("app.providers.translation.GoogleTranslateProvider", lambda: google)
    provider = build_translation_provider(Settings(_env_file=None, translation_provider="primary-test", translation_fallback_provider="missing-test"))
    result = asyncio.run(provider.translate_segments((TranscriptionSegment(0, 1, "Xin chào mọi người"),), "vi", "en"))
    assert result[0].text == "Hello everyone" and len(google.calls) == 1


def test_fallback_rejects_misaligned_timestamps():
    original = (TranscriptionSegment(0, 1000, "Xin chào mọi người"),)
    with pytest.raises(TranslationProviderError):
        validate_translation(original, (TranscriptionSegment(500, 1000, "Hello everyone"),), "vi", "en")


@pytest.mark.parametrize("result", [{"translations": []}, {"translations": [None]}, LLMProviderError("rate limited")])
def test_groq_does_not_disguise_failure_as_source_text(monkeypatch, result):
    async def generate(*_args):
        if isinstance(result, Exception):
            raise result
        return result
    provider = GroqTranslationProvider("test-key", "test-model", "https://example.test")
    monkeypatch.setattr(provider, "_generate", generate)
    with pytest.raises(TranslationProviderError):
        asyncio.run(provider.translate_segments((TranscriptionSegment(0, 1, "Xin chào mọi người"),), "vi", "en"))


@pytest.mark.parametrize("mode", ["error", "echo", "success"])
def test_instant_translation_honors_target_and_never_returns_source_on_failure(mode):
    from app.api.v1.routes.ai import _gtx_translate_single
    async def scenario():
        def response(request):
            assert request.url.params["tl"] == "en" and request.url.params["sl"] == "auto"
            if mode == "error":
                return httpx.Response(503)
            return httpx.Response(200, json=[[["Xin chào mọi người" if mode == "echo" else "Hello everyone", "source"]]])
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            result = await _gtx_translate_single(client, "Xin chào mọi người", "auto", "en")
        assert result == ("Hello everyone" if mode == "success" else "")
    asyncio.run(scenario())


def test_unchanged_numbers_and_short_interjections_are_valid():
    values = tuple(TranscriptionSegment(i, i+1, text) for i, text in enumerate(["2026", "OK", "AI"]))
    assert validate_translation(values, values, "vi", "en") == values
