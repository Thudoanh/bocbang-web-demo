"""Backend-only registry for pluggable STT adapters.

No provider is bundled in the foundation. Deployments register an adapter here
or during application construction; routes and domain services only consume the
normalized contracts.
"""

from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from app.core.config import Settings
from app.providers.contracts import (
    KnownSpeaker,
    SpeakerEnrollmentProvider,
    StreamingOptions,
    STTCapabilities,
    STTProvider,
    STTProviderError,
    TranscriptionResult,
)

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

# Importing registers deployment adapters while keeping vendor code out of services.
from app.providers.assemblyai import build_assemblyai_provider  # noqa: E402
from app.providers.speechmatics import build_speechmatics_provider  # noqa: E402

stt_provider_registry.register("assemblyai", build_assemblyai_provider)
stt_provider_registry.register("speechmatics", build_speechmatics_provider)


class FallbackSTTProvider:
    """Use a secondary provider only when the primary fails before audio is lost."""

    def __init__(self, primary: STTProvider, fallback: STTProvider) -> None:
        self._primary = primary
        self._fallback = fallback

    def capabilities(self) -> STTCapabilities:
        return self._primary.capabilities()

    async def transcribe_file(
        self,
        source: Path,
        language: str | None = None,
        known_speakers: tuple[KnownSpeaker, ...] = (),
    ) -> TranscriptionResult:
        try:
            return await self._primary.transcribe_file(source, language, known_speakers)
        except STTProviderError as exc:
            if not exc.retryable:
                raise
            # The fallback may diarize, but it cannot consume Speechmatics identifiers.
            result = await self._fallback.transcribe_file(source, language, ())
            return replace(result, fallback_active=True)

    async def open_stream(self, options: StreamingOptions):
        try:
            return await self._primary.open_stream(options)
        except STTProviderError as exc:
            if not exc.retryable:
                raise
            stream = await self._fallback.open_stream(
                StreamingOptions(
                    language=options.language,
                    diarization=options.diarization,
                    audio_format=options.audio_format,
                    known_speakers=(),
                )
            )
            stream.fallback_active = True
            return stream


def build_stt_provider(settings: Settings) -> STTProvider | None:
    primary = stt_provider_registry.build(settings)
    if primary is None or not settings.stt_fallback_provider:
        return primary
    fallback_name = settings.stt_fallback_provider.strip().lower()
    primary_name = (settings.stt_provider or "").strip().lower()
    if fallback_name == primary_name:
        return primary
    factory = stt_provider_registry._factories.get(fallback_name)
    if factory is None:
        return primary
    return FallbackSTTProvider(primary, factory(settings))


def build_speaker_enrollment_provider(
    settings: Settings,
) -> SpeakerEnrollmentProvider | None:
    if not settings.speechmatics_api_key:
        return None
    return build_speechmatics_provider(settings)
