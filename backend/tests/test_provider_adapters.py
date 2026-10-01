import asyncio

from app.core.config import Settings
from app.providers.assemblyai import AssemblyAIProvider, _batch_result, _stream_event
from app.providers.contracts import TranscriptionSegment
from app.providers.gemini import GeminiSummaryProvider, GeminiTranslationProvider


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
