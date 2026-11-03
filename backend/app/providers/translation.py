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
        except Exception:
            return await self._fallback.translate_segments(segments, source, target)


translation_provider_registry = TranslationProviderRegistry()

from app.providers.gemini import build_gemini_translation_provider  # noqa: E402
from app.providers.groq import build_groq_translation_provider  # noqa: E402
from app.providers.google_translate import (  # noqa: E402
    GoogleTranslateProvider,
    build_google_translation_provider,
)

translation_provider_registry.register("gemini", build_gemini_translation_provider)
translation_provider_registry.register("groq", build_groq_translation_provider)
translation_provider_registry.register("google", build_google_translation_provider)
translation_provider_registry.register("google_translate", build_google_translation_provider)


def build_translation_provider(settings: Settings) -> TranslationProvider:
    primary = translation_provider_registry.build(settings) if settings.translation_provider else None
    google_fallback = GoogleTranslateProvider()
    if primary is None:
        return google_fallback
    return FallbackTranslationProvider(primary, google_fallback)
