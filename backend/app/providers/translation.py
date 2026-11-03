"""Backend-only registry for provider-neutral translation adapters."""

from collections.abc import Callable

from app.core.config import Settings
from app.core.logging import get_logger
from app.providers.translation_validation import validate_translation
from app.providers.contracts import (
    TranscriptionSegment,
    TranslationCapabilities,
    TranslationProvider,
    TranslationProviderError,
)

TranslationProviderFactory = Callable[[Settings], TranslationProvider]
logger = get_logger(__name__)


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
            result = await self._primary.translate_segments(segments, source, target)
            return validate_translation(segments, result, source, target)
        except Exception as exc:
            logger.warning("translation_fallback_activated", extra={
                "primary_provider": type(self._primary).__name__,
                "fallback_provider": type(self._fallback).__name__,
                "error_code": getattr(exc, "code", type(exc).__name__),
                "segment_count": len(segments),
            })
            result = await self._fallback.translate_segments(segments, source, target)
            return validate_translation(segments, result, source, target)


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
    fallback = google_fallback
    fallback_name = (settings.translation_fallback_provider or "").strip().lower()
    if fallback_name and fallback_name not in {settings.translation_provider.strip().lower(), "google", "google_translate"}:
        factory = translation_provider_registry.factory_for(fallback_name)
        if factory is None:
            raise ValueError(f"Unsupported translation fallback provider: {fallback_name}.")
        try:
            fallback = FallbackTranslationProvider(factory(settings), google_fallback)
        except ValueError:
            # Optional cloud credentials may be absent. Google remains available.
            logger.warning("translation_fallback_unavailable", extra={"provider": fallback_name})
    return FallbackTranslationProvider(primary, fallback)
