"""Public capability discovery for provider-dependent client controls."""

from typing import cast

from fastapi import APIRouter, Request

from app.core.config import Settings
from app.providers.contracts import LLMProvider, STTProvider, TranslationProvider

router = APIRouter()


@router.get("/capabilities")
async def capabilities(request: Request) -> dict[str, object]:
    settings = cast(Settings, request.app.state.settings)
    provider = cast(STTProvider | None, getattr(request.app.state, "stt_provider", None))
    translation_provider = cast(TranslationProvider | None, getattr(request.app.state, "translation_provider", None))
    llm_provider = cast(LLMProvider | None, getattr(request.app.state, "llm_provider", None))
    if provider is None:
        stt: dict[str, object] = {
            "provider": settings.stt_provider or "unconfigured",
            "batch": False,
            "streaming": False,
            "diarization": False,
            "timestamps": False,
            "confidence": False,
            "languages": [],
        }
    else:
        available = provider.capabilities()
        stt = {
            "provider": settings.stt_provider or provider.__class__.__name__,
            "batch": available.batch,
            "streaming": available.streaming,
            "diarization": available.diarization,
            "timestamps": available.timestamps,
            "confidence": available.confidence,
            "languages": sorted(available.supported_languages),
        }
    pairs = sorted(translation_provider.capabilities().supported_language_pairs) if translation_provider else []
    return {
        "stt": stt,
        "translation": {"languages": sorted({language for pair in pairs for language in pair}), "language_pairs": [list(pair) for pair in pairs]},
        "summary_templates": ["general", "briefing", "voting"] if llm_provider and llm_provider.capabilities().structured_output else [],
        "summary_languages": ["vi", "en"] if llm_provider and llm_provider.capabilities().structured_output else [],
        "exports": ["pdf", "docx", "txt", "srt", "vtt", "json"],
    }
