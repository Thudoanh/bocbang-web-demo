"""Backend-only registry for provider-neutral LLM adapters."""

from collections.abc import Callable

from app.core.config import Settings
from app.providers.contracts import LLMProvider

LLMProviderFactory = Callable[[Settings], LLMProvider]


class LLMProviderRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, LLMProviderFactory] = {}

    def register(self, name: str, factory: LLMProviderFactory) -> None:
        self._factories[name.strip().lower()] = factory

    def build(self, settings: Settings) -> LLMProvider | None:
        if not settings.llm_provider:
            return None
        factory = self._factories.get(settings.llm_provider.strip().lower())
        return factory(settings) if factory else None


llm_provider_registry = LLMProviderRegistry()

from app.providers.gemini import build_gemini_summary_provider  # noqa: E402

llm_provider_registry.register("gemini", build_gemini_summary_provider)


def build_llm_provider(settings: Settings) -> LLMProvider | None:
    return llm_provider_registry.build(settings)
