"""Backend-only registry for provider-neutral translation adapters."""

from collections.abc import Callable

from app.core.config import Settings
from app.providers.contracts import TranslationProvider

TranslationProviderFactory = Callable[[Settings], TranslationProvider]


class TranslationProviderRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, TranslationProviderFactory] = {}

    def register(self, name: str, factory: TranslationProviderFactory) -> None:
        self._factories[name.strip().lower()] = factory

    def build(self, settings: Settings) -> TranslationProvider | None:
        if not settings.translation_provider:
            return None
        factory = self._factories.get(settings.translation_provider.strip().lower())
        return factory(settings) if factory else None


translation_provider_registry = TranslationProviderRegistry()

from app.providers.gemini import build_gemini_translation_provider  # noqa: E402

translation_provider_registry.register("gemini", build_gemini_translation_provider)


def build_translation_provider(settings: Settings) -> TranslationProvider | None:
    return translation_provider_registry.build(settings)
