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
    StreamingSpeakerRevision,
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


def test_assemblyai_batch_sends_language_detection_for_auto(tmp_path) -> None:
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
                "language_code": "en",
                "utterances": [{"start": 0, "end": 1200, "text": "Hello world"}],
            })

    source = tmp_path / "audio.wav"
    source.write_bytes(b"audio")
    client = Client()
    provider = AssemblyAIProvider(
        Settings(_env_file=None, stt_api_key="key", media_storage_path=tmp_path),
        client=client,
    )
    result = asyncio.run(provider.transcribe_file(source, "auto"))
    request = client.posts[1][1]["json"]
    assert isinstance(request, dict) and request.get("language_detection") is True
    assert "language_code" not in request
    assert result.language == "en"


def test_fallback_stt_provider_routes_auto_to_multilingual_fallback(tmp_path) -> None:
    from app.providers.stt import FallbackSTTProvider
    from app.providers.contracts import STTCapabilities, STTProvider, TranscriptionResult

    class MockPrimary(STTProvider):
        def capabilities(self) -> STTCapabilities:
            return STTCapabilities(True, True, True, True, True, frozenset({"vi", "en"}), False)

        async def transcribe_file(self, source, language=None, known_speakers=()):
            raise AssertionError("Primary should not be called when language is auto")

        async def open_stream(self, options):
            raise NotImplementedError

    class MockFallback(STTProvider):
        def capabilities(self) -> STTCapabilities:
            return STTCapabilities(True, True, True, True, True, frozenset({"vi", "en"}), True)

        async def transcribe_file(self, source, language=None, known_speakers=()):
            return TranscriptionResult("en", (TranscriptionSegment(0, 1000, "English speech"),), provider_name="assemblyai")

        async def open_stream(self, options):
            raise NotImplementedError

    fallback_provider = FallbackSTTProvider(MockPrimary(), MockFallback())
    assert fallback_provider.capabilities().multilingual_auto_detect is True
    source = tmp_path / "test.wav"
    source.write_bytes(b"data")
    res = asyncio.run(fallback_provider.transcribe_file(source, "auto"))
    assert res.language == "en"
    assert res.fallback_active is True


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
        assert query["speaker_labels"] == ["true"]
        assert query["speaker_labels_revision_interval_ms"] == ["300000"]
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
            "speaker_label": "A",
            "turn_order": 0,
        }))
        await asyncio.sleep(0)
        events = await stream.send_audio(b"audio")
        assert len(events) == 1
        assert events[0].type == "final"
        assert events[0].language == "vi"
        assert events[0].segment.confidence == 0.96
        assert events[0].segment.speaker_label == "A"
        assert events[0].turn_order == 0

        closing = asyncio.create_task(stream.close())
        await asyncio.sleep(0)
        await websocket.incoming.put(json.dumps({
            "type": "SpeakerRevision",
            "revisions": [{"turn_order": 0, "speaker_label": "B"}],
        }))
        await websocket.incoming.put(json.dumps({"type": "Termination", "audio_duration_seconds": 1}))
        assert await closing == (StreamingSpeakerRevision(0, "B"),)
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


@pytest.mark.parametrize("label", [None, "PENDING", "UNKNOWN", "", "A"])
def test_streaming_normalizes_unassigned_speakers_and_honors_disabled_mode(label):
    payload = {
        "type": "Turn", "transcript": "Hello", "end_of_turn": True,
        "speaker_label": label, "words": [{"start": 0, "end": 900}],
    }
    event = _stream_event(payload)
    assert event.segment.speaker_label == ("A" if label == "A" else None)
    assert _stream_event(payload, diarization=False).segment.speaker_label is None


def test_streaming_disabled_diarization_and_duplicate_finals(monkeypatch):
    async def scenario():
        websocket = FakeAssemblyWebSocket({"type": "Begin", "id": "session"})
        async def connect(url, **kwargs):
            assert parse_qs(urlparse(url).query)["speaker_labels"] == ["false"]
            assert "speaker_labels_revision_interval_ms" not in parse_qs(urlparse(url).query)
            return websocket
        monkeypatch.setattr(websockets, "connect", connect)
        stream = await AssemblyAIStream.connect(
            "key", "wss://test/v3/ws", "universal-3-6-pro", "balanced",
            StreamingOptions(language="vi", diarization=False),
        )
        payload = {
            "type": "Turn", "transcript": "Hello", "end_of_turn": True,
            "turn_order": 1, "speaker_label": "A", "words": [{"start": 0, "end": 900}],
        }
        for _ in range(2):
            await websocket.incoming.put(json.dumps(payload))
        await websocket.incoming.put(json.dumps({
            "type": "SpeakerRevision", "revisions": [{"turn_order": 1, "speaker_label": "B"}],
        }))
        await asyncio.sleep(0)
        events = await stream.send_audio(b"audio")
        assert len(events) == 1 and events[0].segment.speaker_label is None
        closing = asyncio.create_task(stream.close())
        await asyncio.sleep(0)
        await websocket.incoming.put(json.dumps({"type": "Termination"}))
        assert await closing == ()
    asyncio.run(scenario())


def test_groq_translation_multi_batch_and_malformed_fallback(monkeypatch) -> None:
    provider = GroqTranslationProvider("key", "qwen/qwen3.8-27b", "https://groq.test/openai/v1")
    call_count = 0

    async def response(prompt, *_args, **_kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # Thirty rows are deliberately coalesced into one batch.
            return {"translations": [f"Dịch {i}" for i in range(30)]}
        return {"unknown_key": "data"}

    monkeypatch.setattr(provider, "_generate", response)
    segments = tuple(TranscriptionSegment(i * 1000, (i + 1) * 1000, f"Segment {i}") for i in range(30))
    translated = asyncio.run(provider.translate_segments(segments, "en", "vi"))

    assert len(translated) == 30
    # Upload translation batches are deliberately 30--35 rows; 30 inputs fit
    # in one Groq request while preserving all ordering guarantees.
    assert call_count == 1
    assert translated[0].text == "Dịch 0"
    assert translated[14].text == "Dịch 14"
    assert translated[15].text == "Dịch 15"
    assert translated[29].text == "Dịch 29"


def test_groq_translation_survives_failed_chunk(monkeypatch) -> None:
    provider = GroqTranslationProvider("key", "qwen/qwen3.8-27b", "https://groq.test/openai/v1")

    async def response(*_args, **_kwargs):
        raise LLMProviderError("Transient error", code="GROQ_RATE_LIMITED", retryable=False)

    monkeypatch.setattr(provider, "_generate", response)
    segments = (TranscriptionSegment(0, 1000, "Good luck"), TranscriptionSegment(1000, 2000, "Thank you"))
    # A failed provider/GTX path leaves detectable blanks; callers must never
    # persist original source text as if it were translated.
    translated = asyncio.run(provider.translate_segments(segments, "en", "vi"))
    assert len(translated) == 2
    assert translated[0].text == ""
    assert translated[1].text == ""


def test_condense_transcript_preserves_bounds() -> None:
    from app.providers.groq import _condense_transcript_for_llm
    long_transcript = "\n".join(f"Speaker A: Line {i} with some content discussing project roadmap." for i in range(1000))
    assert len(long_transcript) > 50000
    condensed = _condense_transcript_for_llm(long_transcript, max_chars=16000)
    assert len(condensed) <= 16000
    assert "Line 0" in condensed
    assert "Line 999" in condensed


def test_transcript_polish_sub_batches_long_inputs(monkeypatch) -> None:
    provider = GroqSummaryProvider("key", "qwen/qwen3.8-27b", "https://groq.test/openai/v1")
    generated_batches = []

    async def fake_generate(prompt, schema, schema_name="meeting_summary", max_tokens=None, use_json_object=False, **_kwargs):
        data = json.loads(prompt[prompt.rfind('{"context"'):])
        segs = data["segments"]
        generated_batches.append(len(segs))
        return {"texts": [f"Polished {t}" for t in segs]}

    monkeypatch.setattr(provider, "_generate", fake_generate)
    input_segments = tuple(f"Segment {i}" for i in range(40))
    polished = asyncio.run(provider.polish_transcript(input_segments, "context"))
    assert len(polished) == 40
    # 40 segments split into batches of 15, 15, 10
    assert generated_batches == [15, 15, 10]
    assert polished[0] == "Polished Segment 0"
    assert polished[39] == "Polished Segment 39"


