import asyncio

from app.core.config import Settings
from app.providers.assemblyai import AssemblyAIProvider, _batch_result, _stream_event
from app.providers.contracts import (
    LLMCapabilities,
    LLMProviderError,
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
    result = asyncio.run(provider.generate_summary("Transcript", "general"))
    assert provider.capabilities().structured_output
    assert result["overview"] == "Overview"


def test_groq_summary_declares_structured_output(monkeypatch) -> None:
    provider = GroqSummaryProvider("key", "openai/gpt-oss-20b", "https://groq.test/openai/v1")

    async def response(*_args):
        return {"overview": "Overview", "key_points": [], "action_items": [], "decisions": [], "risks_notes": []}

    monkeypatch.setattr(provider, "_generate", response)
    result = asyncio.run(provider.generate_summary("Transcript", "general"))
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
    assert asyncio.run(provider.generate_summary("Transcript", "general"))["overview"] == "Fallback"


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
