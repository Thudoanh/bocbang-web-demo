"""Backend-only registry for provider-neutral translation adapters."""

from collections.abc import Callable

from app.core.config import Settings
from app.providers.contracts import (
    TranscriptionSegment,
    TranslationCapabilities,
    TranslationProvider,
    TranslationProviderError,
)

TranslationProviderFactory = Callable[[Settings], TranslationProvider]


class TranslationProviderRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, TranslationProviderFactory] = {}

    def register(self, name: str, factory: TranslationProviderFactory) -> None:
        self._factories[name.strip().lower()] = factory

    def factory_for(self, name: str) -> TranslationProviderFactory | None:
        return self._factories.get(name.strip().lower())

    def build(self, settings: Settings) -> TranslationProvider | None:
        if not settings.translation_provider:
            return None
        factory = self._factories.get(settings.translation_provider.strip().lower())
        return factory(settings) if factory else None


class FallbackTranslationProvider:
    """Try a secondary translator only after the primary translator returns an error."""

    def __init__(self, primary: TranslationProvider, fallback: TranslationProvider) -> None:
        self._primary, self._fallback = primary, fallback

    def capabilities(self) -> TranslationCapabilities:
        return TranslationCapabilities(
            self._primary.capabilities().supported_language_pairs
            | self._fallback.capabilities().supported_language_pairs
        )

    async def translate_segments(
        self, segments: tuple[TranscriptionSegment, ...], source: str, target: str
    ) -> tuple[TranscriptionSegment, ...]:
        try:
            return await self._primary.translate_segments(segments, source, target)
        except TranslationProviderError:
            return await self._fallback.translate_segments(segments, source, target)


translation_provider_registry = TranslationProviderRegistry()

from app.providers.gemini import build_gemini_translation_provider  # noqa: E402
from app.providers.groq import build_groq_translation_provider  # noqa: E402

translation_provider_registry.register("gemini", build_gemini_translation_provider)
translation_provider_registry.register("groq", build_groq_translation_provider)


def build_translation_provider(settings: Settings) -> TranslationProvider | None:
    primary = translation_provider_registry.build(settings)
    if primary is None or not settings.translation_fallback_provider:
        return primary
    fallback_name = settings.translation_fallback_provider.strip().lower()
    primary_name = settings.translation_provider.strip().lower() if settings.translation_provider else ""
    if fallback_name == primary_name:
        raise ValueError("TRANSLATION_FALLBACK_PROVIDER must be different from TRANSLATION_PROVIDER.")
    factory = translation_provider_registry.factory_for(fallback_name)
    if factory is None:
        raise ValueError(f"Unsupported translation fallback provider: {settings.translation_fallback_provider}.")
    return FallbackTranslationProvider(primary, factory(settings))
