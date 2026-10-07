import asyncio
import json
from collections import deque
from urllib.parse import parse_qs, urlparse

import pytest
import websockets

from app.core.config import Settings
from app.providers.assemblyai import (
    AssemblyAIProvider,
    AssemblyAIStream,
    _batch_result,
    _stream_event,
)
from app.providers.contracts import (
    LLMCapabilities,
    LLMProviderError,
    StreamingOptions,
    STTProviderError,
    TranscriptionSegment,
    TranslationCapabilities,
    TranslationProviderError,
)
from app.providers.gemini import GeminiSummaryProvider, GeminiTranslationProvider
from app.providers.groq import GroqSummaryProvider, GroqTranslationProvider
from app.providers.llm import FallbackLLMProvider, build_llm_provider
from app.providers.translation import FallbackTranslationProvider, build_translation_provider


def test_assemblyai_maps_batch_utterances_and_realtime_turns(tmp_path) -> None:
    result = _batch_result({"language_code": "vi", "utterances": [{"start": 0, "end": 1200, "text": "Xin chào", "speaker": "A", "confidence": 0.97}]})
    assert result.language == "vi"
    assert result.segments[0] == TranscriptionSegment(0, 1200, "Xin chào", "A", 0.97)
    event = _stream_event({"type": "Turn", "end_of_turn": True, "transcript": "Hello", "words": [{"start": 1200, "end": 1600}]})
    assert event is not None and event.type == "final" and event.segment.start_ms == 1200
    provider = AssemblyAIProvider(Settings(_env_file=None, stt_api_key="key", media_storage_path=tmp_path))
    assert provider.capabilities().batch and provider.capabilities().streaming


def test_assemblyai_batch_sends_selected_language(tmp_path) -> None:
    class Response:
        is_error = False

        def __init__(self, payload: dict[str, object]) -> None:
            self._payload = payload

        def json(self) -> dict[str, object]:
            return self._payload

    class Client:
        def __init__(self) -> None:
            self.posts: list[tuple[str, dict[str, object]]] = []

        async def post(self, url: str, **kwargs):
            self.posts.append((url, kwargs))
            if url.endswith("/upload"):
                return Response({"upload_url": "https://upload.test/audio"})
            return Response({"id": "transcript-id"})

        async def get(self, *_args, **_kwargs):
            return Response({
                "status": "completed",
                "language_code": "vi",
                "utterances": [{"start": 0, "end": 800, "text": "Xin chào"}],
            })

    source = tmp_path / "audio.wav"
    source.write_bytes(b"audio")
    client = Client()
    provider = AssemblyAIProvider(
        Settings(_env_file=None, stt_api_key="key", media_storage_path=tmp_path),
        client=client,
    )
    result = asyncio.run(provider.transcribe_file(source, "vi"))
    request = client.posts[1][1]["json"]
    assert isinstance(request, dict) and request["language_code"] == "vi"
    assert result.language == "vi"


def test_gemini_translation_preserves_segment_alignment(monkeypatch) -> None:
    provider = GeminiTranslationProvider("key", "model", "https://gemini.test/v1beta")

    async def response(*_args):
        return {"translations": ["Hello", "World"]}

    monkeypatch.setattr(provider, "_generate", response)
    segments = (TranscriptionSegment(0, 1, "Xin chào"), TranscriptionSegment(1, 2, "Thế giới"))
    translated = asyncio.run(provider.translate_segments(segments, "vi", "en"))
    assert [item.text for item in translated] == ["Hello", "World"]
    assert [item.start_ms for item in translated] == [0, 1]


def test_gemini_summary_declares_structured_output(monkeypatch) -> None:
    provider = GeminiSummaryProvider("key", "model", "https://gemini.test/v1beta")

    async def response(*_args):
        return {"overview": "Overview", "key_points": [], "action_items": [], "decisions": [], "risks_notes": []}

    monkeypatch.setattr(provider, "_generate", response)
    result = asyncio.run(provider.generate_summary("Transcript", "general", "vi"))
    assert provider.capabilities().structured_output
    assert result["overview"] == "Overview"


def test_groq_summary_declares_structured_output(monkeypatch) -> None:
    provider = GroqSummaryProvider("key", "openai/gpt-oss-20b", "https://groq.test/openai/v1")

    async def response(*_args):
        return {"overview": "Overview", "key_points": [], "action_items": [], "decisions": [], "risks_notes": []}

    monkeypatch.setattr(provider, "_generate", response)
    result = asyncio.run(provider.generate_summary("Transcript", "general", "en"))
    assert provider.capabilities().structured_output
    assert result["overview"] == "Overview"


def test_groq_translation_preserves_segment_alignment(monkeypatch) -> None:
    provider = GroqTranslationProvider("key", "openai/gpt-oss-20b", "https://groq.test/openai/v1")

    async def response(*_args):
        return {"translations": ["Hello", "World"]}

    monkeypatch.setattr(provider, "_generate", response)
    segments = (TranscriptionSegment(0, 1, "Xin chào"), TranscriptionSegment(1, 2, "Thế giới"))
    translated = asyncio.run(provider.translate_segments(segments, "vi", "en"))
    assert [item.text for item in translated] == ["Hello", "World"]
    assert [item.start_ms for item in translated] == [0, 1]


def test_llm_fallback_uses_secondary_after_primary_failure() -> None:
    class FailingProvider:
        def capabilities(self) -> LLMCapabilities:
            return LLMCapabilities(structured_output=True, max_context_tokens=4096)

        async def generate_summary(self, *_args) -> dict[str, object]:
            raise LLMProviderError("Gemini unavailable.")

    class SuccessfulProvider:
        def capabilities(self) -> LLMCapabilities:
            return LLMCapabilities(structured_output=True, max_context_tokens=131_072)

        async def generate_summary(self, *_args) -> dict[str, object]:
            return {"overview": "Fallback", "key_points": [], "action_items": [], "decisions": [], "risks_notes": []}

    provider = FallbackLLMProvider(FailingProvider(), SuccessfulProvider())
    assert asyncio.run(provider.generate_summary("Transcript", "general", "en"))["overview"] == "Fallback"


def test_llm_registry_builds_groq_fallback() -> None:
    provider = build_llm_provider(
        Settings(
            _env_file=None,
            llm_provider="gemini",
            llm_api_key="gemini-key",
            llm_fallback_provider="groq",
            groq_api_key="groq-key",
        )
    )
    assert isinstance(provider, FallbackLLMProvider)


def test_translation_fallback_uses_secondary_after_primary_failure() -> None:
    class FailingProvider:
        def capabilities(self) -> TranslationCapabilities:
            return TranslationCapabilities(frozenset({("vi", "en")}))

        async def translate_segments(self, *_args) -> tuple[TranscriptionSegment, ...]:
            raise TranslationProviderError("Gemini unavailable.")

    class SuccessfulProvider:
        def capabilities(self) -> TranslationCapabilities:
            return TranslationCapabilities(frozenset({("vi", "en")}))

        async def translate_segments(self, segments, *_args) -> tuple[TranscriptionSegment, ...]:
            return segments

    provider = FallbackTranslationProvider(FailingProvider(), SuccessfulProvider())
    segments = (TranscriptionSegment(0, 1, "Xin chào"),)
    assert asyncio.run(provider.translate_segments(segments, "vi", "en")) == segments


def test_translation_registry_builds_groq_fallback() -> None:
    provider = build_translation_provider(
        Settings(
            _env_file=None,
            translation_provider="gemini",
            translation_api_key="gemini-key",
            translation_fallback_provider="groq",
            groq_api_key="groq-key",
        )
    )
    assert isinstance(provider, FallbackTranslationProvider)


class FakeAssemblyWebSocket:
    def __init__(self, handshake: dict[str, object]) -> None:
        self.handshakes = deque([json.dumps(handshake)])
        self.incoming: asyncio.Queue[str | None] = asyncio.Queue()
        self.sent: list[bytes | str] = []
        self.closed = False

    async def recv(self) -> str:
        return self.handshakes.popleft()

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        value = await self.incoming.get()
        if value is None:
            raise StopAsyncIteration
        return value

    async def send(self, value: bytes | str) -> None:
        self.sent.append(value)

    async def close(self) -> None:
        self.closed = True
        await self.incoming.put(None)



def test_assemblyai_stream_uses_configured_model_waits_for_begin_and_termination(monkeypatch) -> None:
    async def scenario() -> None:
        websocket = FakeAssemblyWebSocket({"type": "Begin", "id": "session"})
        captured_url = ""

        async def connect(url: str, **_kwargs):
            nonlocal captured_url
            captured_url = url
            return websocket

        monkeypatch.setattr(websockets, "connect", connect)
        stream = await AssemblyAIStream.connect(
            "secret",
            "wss://streaming.test/v3/ws",
            "universal-3-6-pro",
            "balanced",
            StreamingOptions(language="vi", diarization=True),
        )
        query = parse_qs(urlparse(captured_url).query)
        assert query["speech_model"] == ["universal-3-6-pro"]
        assert query["mode"] == ["balanced"]
        assert query["language_codes"] == ["vi"]
        assert query["prompt"] == [
            "Transcribe Vietnamese. Transcribe verbatim with standard punctuation. "
            "Keep the spoken language and do not translate it."
        ]

        await websocket.incoming.put(json.dumps({
            "type": "Turn",
            "transcript": "Xin chào",
            "end_of_turn": True,
            "words": [{"start": 0, "end": 800}],
            "end_of_turn_confidence": 0.96,
        }))
        await asyncio.sleep(0)
        events = await stream.send_audio(b"audio")
        assert len(events) == 1
        assert events[0].type == "final"
        assert events[0].language == "vi"
        assert events[0].segment.confidence == 0.96

        closing = asyncio.create_task(stream.close())
        await asyncio.sleep(0)
        await websocket.incoming.put(json.dumps({"type": "Termination", "audio_duration_seconds": 1}))
        assert await closing == ()
        assert json.loads(str(websocket.sent[-1])) == {"type": "Terminate"}
        assert websocket.closed

    asyncio.run(scenario())



def test_assemblyai_stream_exposes_handshake_validation_error(monkeypatch) -> None:
    async def scenario() -> None:
        websocket = FakeAssemblyWebSocket({
            "type": "Error",
            "error": "User Input Validation Error: Invalid 'speech_model'",
        })

        async def connect(*_args, **_kwargs):
            return websocket

        monkeypatch.setattr(websockets, "connect", connect)
        with pytest.raises(STTProviderError) as captured:
            await AssemblyAIStream.connect(
                "secret",
                "wss://streaming.test/v3/ws",
                "universal-3-pro",
                "balanced",
                StreamingOptions(language="vi", diarization=True),
            )
        error = captured.value
        assert error.code == "STT_STREAM_REJECTED"
        assert error.retryable is False
        assert "Invalid 'speech_model'" in str(error)
        assert websocket.closed

    asyncio.run(scenario())


def test_assemblyai_stream_rejects_unsupported_language_before_connect(monkeypatch) -> None:
    async def scenario() -> None:
        connected = False

        async def connect(*_args, **_kwargs):
            nonlocal connected
            connected = True
            raise AssertionError("Provider connection must not be opened.")

        monkeypatch.setattr(websockets, "connect", connect)
        with pytest.raises(STTProviderError) as captured:
            await AssemblyAIStream.connect(
                "secret",
                "wss://streaming.test/v3/ws",
                "universal-3-6-pro",
                "balanced",
                StreamingOptions(language="fr", diarization=False),
            )

        assert connected is False
        assert captured.value.code == "STT_LANGUAGE_UNSUPPORTED"
        assert captured.value.retryable is False

    asyncio.run(scenario())


def test_assemblyai_streaming_defaults_and_mode_validation() -> None:
    settings = Settings(_env_file=None)
    assert settings.assemblyai_streaming_model == "universal-3-6-pro"
    assert settings.assemblyai_streaming_mode == "balanced"

    with pytest.raises(ValueError):
        Settings(_env_file=None, assemblyai_streaming_mode="fastest")
