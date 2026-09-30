"""Backend-only registry for pluggable STT adapters.

No provider is bundled in the foundation. Deployments register an adapter here
or during application construction; routes and domain services only consume the
normalized contracts.
"""

from collections.abc import Callable

from app.core.config import Settings
from app.providers.contracts import STTProvider

STTProviderFactory = Callable[[Settings], STTProvider]


class STTProviderRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, STTProviderFactory] = {}

    def register(self, name: str, factory: STTProviderFactory) -> None:
        self._factories[name.strip().lower()] = factory

    def build(self, settings: Settings) -> STTProvider | None:
        """Return the configured adapter, or ``None`` when it is unavailable."""
        if not settings.stt_provider:
            return None
        factory = self._factories.get(settings.stt_provider.strip().lower())
        return factory(settings) if factory else None


stt_provider_registry = STTProviderRegistry()


def build_stt_provider(settings: Settings) -> STTProvider | None:
    return stt_provider_registry.build(settings)
