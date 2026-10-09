"""Speechmatics batch, realtime, and speaker-enrollment adapter."""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from collections.abc import Callable
from pathlib import Path
from time import perf_counter
from typing import Any

from app.core.config import Settings
from app.providers.contracts import (
    KnownSpeaker,
    SpeakerEnrollment,
    StreamingEvent,
    StreamingOptions,
    StreamingTranscriptionEvent,
    STTCapabilities,
    STTProviderError,
    TranscriptionResult,
    TranscriptionSegment,
)

logger = logging.getLogger(__name__)


class SpeechmaticsProvider:
    def __init__(
        self,
        settings: Settings,
        *,
        batch_client_factory: Callable[..., Any] | None = None,
        voice_client_factory: Callable[..., Any] | None = None,
    ) -> None:
        if not settings.speechmatics_api_key:
            raise ValueError(
                "SPEECHMATICS_API_KEY is required when STT_PROVIDER=speechmatics."
            )
        self._key = settings.speechmatics_api_key
        self._batch_url = settings.speechmatics_batch_url
        self._rt_url = settings.speechmatics_rt_url
        self._sensitivity = settings.speechmatics_speaker_sensitivity
        self._prefer_current = settings.speechmatics_prefer_current_speaker
        self._silence_trigger = settings.speechmatics_end_of_utterance_silence_seconds
        self._max_delay = settings.speechmatics_max_delay_seconds
        self._finalization_delay = settings.speechmatics_finalization_delay_seconds
        if self._silence_trigger >= self._max_delay:
            raise ValueError("Speechmatics silence trigger must be lower than max delay.")
        self._batch_client_factory = batch_client_factory
        self._voice_client_factory = voice_client_factory

    def capabilities(self) -> STTCapabilities:
        return STTCapabilities(
            batch=True,
            streaming=True,
            diarization=True,
            timestamps=True,
            confidence=True,
            supported_languages=frozenset({"vi", "en"}),
            multilingual_auto_detect=False,
        )

    async def enroll_speaker(
        self, source: Path, language: str = "vi"
    ) -> SpeakerEnrollment:
        if not source.is_file():
            raise STTProviderError(
                "Normalized media is unavailable.",
                code="STT_MEDIA_UNAVAILABLE",
                retryable=False,
            )
        try:
            transcript = await self._run_batch(
                source,
                language,
                speaker_config={
                    "get_speakers": True,
                    "prefer_current_speaker": self._prefer_current,
                    "speaker_sensitivity": self._sensitivity,
                },
            )
        except STTProviderError:
            raise
        except Exception as exc:
            raise _provider_error(exc, operation="speaker enrollment") from exc

        speakers = list(getattr(transcript, "speakers", None) or [])
        if not speakers:
            raise STTProviderError(
                "Speechmatics did not find a usable voice in the sample.",
                code="VOICE_PROFILE_NO_SPEECH",
                retryable=False,
            )
        if len(speakers) != 1:
            raise STTProviderError(
                "The voice sample must contain exactly one speaker.",
                code="VOICE_PROFILE_MULTIPLE_SPEAKERS",
                retryable=False,
            )
        identifiers = tuple(
            dict.fromkeys(str(value) for value in speakers[0].speaker_identifiers if value)
        )
        if not identifiers:
            raise STTProviderError(
                "Speechmatics did not return a speaker identifier.",
                code="VOICE_PROFILE_NO_IDENTIFIER",
                retryable=False,
            )
        duration = max(
            (
                float(getattr(item, "end_time", 0.0) or 0.0)
                for item in (getattr(transcript, "results", None) or [])
            ),
            default=0.0,
        )
        return SpeakerEnrollment(identifiers, max(1, round(duration * 1000)))

    async def transcribe_file(
        self,
        source: Path,
        language: str | None = None,
        known_speakers: tuple[KnownSpeaker, ...] = (),
    ) -> TranscriptionResult:
        if not source.is_file():
            raise STTProviderError(
                "Normalized media is unavailable.",
                code="STT_MEDIA_UNAVAILABLE",
                retryable=False,
            )
        normalized_language = _language(language)
        speaker_config: dict[str, Any] = {
            "prefer_current_speaker": self._prefer_current,
            "speaker_sensitivity": self._sensitivity,
        }
        if known_speakers:
            speaker_config["speakers"] = [
                {
                    "label": speaker.provider_label,
                    "speaker_identifiers": list(speaker.speaker_identifiers),
                }
                for speaker in known_speakers
            ]
        try:
            transcript = await self._run_batch(
                source,
                normalized_language,
                speaker_config=speaker_config,
            )
            return _batch_result(transcript, normalized_language, known_speakers)
        except STTProviderError:
            raise
        except Exception as exc:
            raise _provider_error(exc, operation="batch transcription") from exc

    async def _run_batch(
        self, source: Path, language: str, *, speaker_config: dict[str, Any]
    ) -> Any:
        from speechmatics.batch import AsyncClient, FormatType, TranscriptionConfig

        factory = self._batch_client_factory or AsyncClient
        kwargs: dict[str, Any] = {"api_key": self._key}
        if self._batch_url:
            kwargs["url"] = self._batch_url
        async with factory(**kwargs) as client:
            job = await client.submit_job(
                str(source),
                transcription_config=TranscriptionConfig(
                    language=_language(language),
                    diarization="speaker",
                    speaker_diarization_config=speaker_config,
                ),
            )
            return await client.wait_for_completion(job.id, format_type=FormatType.JSON)

    async def open_stream(self, options: StreamingOptions) -> SpeechmaticsStream:
        try:
            from speechmatics.voice import (
                EndOfUtteranceMode,
                SpeakerIdentifier,
                SpeechSegmentConfig,
                VoiceAgentClient,
                VoiceAgentConfig,
                VoiceAgentConfigPreset,
            )

            config = VoiceAgentConfigPreset.ADAPTIVE(
                VoiceAgentConfig(
                    language=_language(options.language),
                    enable_diarization=options.diarization,
                    speaker_sensitivity=self._sensitivity,
                    prefer_current_speaker=self._prefer_current,
                    known_speakers=[
                        SpeakerIdentifier(
                            label=speaker.provider_label,
                            speaker_identifiers=list(speaker.speaker_identifiers),
                        )
                        for speaker in options.known_speakers
                    ],
                    end_of_utterance_mode=EndOfUtteranceMode.ADAPTIVE,
                    # The SDK's bare custom-config defaults split normal pauses
                    # too aggressively. Overlay the official ADAPTIVE preset and
                    # use a one-second base silence window for meeting speech.
                    end_of_utterance_silence_trigger=self._silence_trigger,
                    # Final fragments are debounced into durable turns below.
                    speech_segment_config=SpeechSegmentConfig(emit_sentences=False),
                    include_partials=True,
                    max_delay=self._max_delay,
                    include_results=True,
                    sample_rate=16000,
                )
            )
            factory = self._voice_client_factory or VoiceAgentClient
            client = factory(
                api_key=self._key,
                url=self._rt_url,
                config=config,
            )
            stream = SpeechmaticsStream(
                client,
                options,
                finalization_delay_seconds=self._finalization_delay,
                max_segment_gap_seconds=self._silence_trigger,
            )
            await stream.connect()
            return stream
        except STTProviderError:
            raise
        except Exception as exc:
            raise _provider_error(exc, operation="realtime connection") from exc


class SpeechmaticsStream:
    provider_name = "speechmatics"
    fallback_active = False

    def __init__(
        self,
        client: Any,
        options: StreamingOptions,
        *,
        finalization_delay_seconds: float = 3.0,
        max_segment_gap_seconds: float = 1.0,
    ) -> None:
        self._client = client
        self._language = _language(options.language)
        self._diarization = options.diarization
        self._known = {item.provider_label: item for item in options.known_speakers}
        self.speaker_identification_available = bool(options.diarization and self._known)
        self._events: deque[StreamingEvent] = deque()
        self._events_ready = asyncio.Event()
        self._failure: STTProviderError | None = None
        self._pending_finals: dict[
            tuple[int, int, str | None], tuple[str, TranscriptionSegment]
        ] = {}
        self._finalization_delay_seconds = finalization_delay_seconds
        self._max_segment_gap_ms = round(max_segment_gap_seconds * 1000)
        self._pending_flush_handle: asyncio.TimerHandle | None = None
        self._pending_started_at: float | None = None
        self._final_keys: set[tuple[int, int, str | None, str]] = set()
        self._completed_fragments: set[tuple[int, int, str | None, str]] = set()
        self._turn_order = 0
        self._closed = False

    async def connect(self) -> None:
        from speechmatics.voice import AgentServerMessageType

        self._client.on(
            AgentServerMessageType.ADD_PARTIAL_SEGMENT,
            lambda payload: self._capture(payload, final=False),
        )
        self._client.on(
            AgentServerMessageType.ADD_SEGMENT,
            lambda payload: self._capture(payload, final=True),
        )
        self._client.on(
            AgentServerMessageType.END_OF_TURN,
            lambda _payload: self._schedule_final_flush(),
        )
        self._client.on(AgentServerMessageType.ERROR, self._capture_error)
        try:
            await self._client.connect()
        except Exception as exc:
            raise _provider_error(exc, operation="realtime connection") from exc

    def _capture(self, payload: Any, *, final: bool) -> None:
        if not isinstance(payload, dict):
            return
        captured: list[tuple[str, TranscriptionSegment]] = []
        for item in payload.get("segments", []):
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            start_ms = _milliseconds(metadata.get("start_time"))
            end_ms = _milliseconds(metadata.get("end_time"))
            if not text or end_ms <= start_ms:
                continue
            label = str(item.get("speaker_id")) if item.get("speaker_id") else None
            if not self._diarization:
                label = None
            known = self._known.get(label or "")
            captured.append(
                (
                    str(item.get("language") or self._language),
                    TranscriptionSegment(
                        start_ms=start_ms,
                        end_ms=end_ms,
                        text=text,
                        speaker_label=label,
                        speaker_name=known.name if known else None,
                        voice_profile_id=known.profile_id if known else None,
                        is_identified=known is not None,
                    ),
                )
            )

        if final:
            # Speechmatics can emit both ADD_SEGMENT and END_OF_TURN after very
            # short phrases. Debounce stable fragments across callbacks so a
            # normal pause between words does not create a durable row. A real
            # speaker change still closes the preceding row immediately.
            for language, segment in sorted(
                captured,
                key=lambda item: (item[1].start_ms, item[1].end_ms),
            ):
                if (
                    segment.start_ms, segment.end_ms, segment.speaker_label, segment.text
                ) in self._completed_fragments:
                    continue
                if self._pending_finals:
                    _, previous = max(
                        self._pending_finals.values(),
                        key=lambda item: (item[1].end_ms, item[1].start_ms),
                    )
                    gap_ms = segment.start_ms - previous.end_ms
                    if (
                        segment.speaker_label != previous.speaker_label
                        or gap_ms > self._max_segment_gap_ms
                    ):
                        self._flush_pending_finals()
                if self._pending_started_at is None:
                    self._pending_started_at = perf_counter()
                self._pending_finals[
                    (segment.start_ms, segment.end_ms, segment.speaker_label)
                ] = (language, segment)
            if captured:
                self._schedule_final_flush()
                # Stable fragments remain visible during the durable-turn debounce.
                self._preview(list(self._pending_finals.values()))
            return

        self._preview(captured)

    def _preview(self, captured: list[tuple[str, TranscriptionSegment]]) -> None:
        for language, segment in _coalesce_stream_segments(captured):
            event = StreamingTranscriptionEvent(
                "partial", language, segment,
                stream_segment_id=self._segment_id(segment),
            )
            self._events.append(event)
            logger.debug(
                "STT provider event=%s type=partial segment=%s audio_end_ms=%s",
                event.event_id, event.stream_segment_id, segment.end_ms,
            )
        if captured:
            self._events_ready.set()

    @staticmethod
    def _segment_id(segment: TranscriptionSegment) -> str:
        return f"{segment.start_ms}:{segment.speaker_label or ''}"

    def _flush_pending_finals(self) -> None:
        if self._pending_flush_handle is not None:
            self._pending_flush_handle.cancel()
            self._pending_flush_handle = None
        pending = sorted(
            self._pending_finals.values(),
            key=lambda item: (item[1].start_ms, item[1].end_ms),
        )
        captured_at = self._pending_started_at or perf_counter()
        self._pending_started_at = None
        self._pending_finals.clear()
        self._completed_fragments.update(
            (segment.start_ms, segment.end_ms, segment.speaker_label, segment.text)
            for _, segment in pending
        )
        for language, segment in _coalesce_stream_segments(pending):
            key = (
                segment.start_ms,
                segment.end_ms,
                segment.speaker_label,
                segment.text,
            )
            if key in self._final_keys:
                continue
            self._final_keys.add(key)
            self._events.append(
                StreamingTranscriptionEvent(
                    "final",
                    language,
                    segment,
                    turn_order=self._turn_order,
                    stream_segment_id=self._segment_id(segment),
                    captured_at=captured_at,
                )
            )
            self._turn_order += 1
        if pending:
            self._events_ready.set()

    def _schedule_final_flush(self) -> None:
        if not self._pending_finals:
            return
        if self._pending_flush_handle is not None:
            self._pending_flush_handle.cancel()
        self._pending_flush_handle = asyncio.get_running_loop().call_later(
            self._finalization_delay_seconds,
            self._flush_pending_finals,
        )

    def _capture_error(self, payload: Any) -> None:
        reason = payload.get("reason") if isinstance(payload, dict) else None
        self._failure = STTProviderError(
            str(reason or "Speechmatics realtime transcription failed."),
            code="STT_STREAM_PROVIDER_ERROR",
            retryable=True,
        )
        self._events_ready.set()

    async def receive_events(self) -> tuple[StreamingEvent, ...]:
        await self._events_ready.wait()
        self._raise_failure()
        return self._drain()

    async def send_audio(self, chunk: bytes) -> tuple[StreamingEvent, ...]:
        if self._closed:
            raise STTProviderError(
                "The realtime session is closed.",
                code="STT_STREAM_CLOSED",
                retryable=False,
            )
        self._raise_failure()
        try:
            await self._client.send_audio(chunk)
            await asyncio.sleep(0)
        except Exception as exc:
            self._raise_failure()
            raise _provider_error(exc, operation="realtime audio") from exc
        self._raise_failure()
        return self._drain()

    async def pause(self) -> tuple[StreamingEvent, ...]:
        self._raise_failure()
        return self._drain()

    async def resume(self) -> tuple[StreamingEvent, ...]:
        self._raise_failure()
        return self._drain()

    async def close(self) -> tuple[StreamingEvent, ...]:
        if self._closed:
            return self._drain()
        try:
            await self._client.disconnect()
            await asyncio.sleep(0)
            # The SDK normally emits END_OF_TURN while disconnecting. Flush as
            # a safeguard for transports that only deliver the last fragments.
            self._flush_pending_finals()
        except Exception as exc:
            raise _provider_error(exc, operation="realtime close") from exc
        finally:
            self._closed = True
        self._raise_failure()
        return self._drain()

    def _raise_failure(self) -> None:
        if self._failure is not None:
            raise self._failure

    def _drain(self) -> tuple[StreamingEvent, ...]:
        events = tuple(self._events)
        self._events.clear()
        self._events_ready.clear()
        return events


def _batch_result(
    transcript: Any,
    default_language: str,
    known_speakers: tuple[KnownSpeaker, ...],
) -> TranscriptionResult:
    known = {item.provider_label: item for item in known_speakers}
    grouped: list[dict[str, Any]] = []
    for result in getattr(transcript, "results", None) or []:
        alternatives = getattr(result, "alternatives", None) or []
        if not alternatives or getattr(result, "type", None) not in {"word", "punctuation"}:
            continue
        alternative = alternatives[0]
        content = str(getattr(alternative, "content", "") or "")
        if not content:
            continue
        speaker = getattr(alternative, "speaker", None)
        label = None if speaker in {None, "", "UU"} else str(speaker)
        start_ms = _milliseconds(getattr(result, "start_time", 0.0))
        end_ms = _milliseconds(getattr(result, "end_time", 0.0))
        if end_ms <= start_ms:
            continue
        confidence = getattr(alternative, "confidence", None)
        language = str(getattr(alternative, "language", None) or default_language)
        if not grouped or grouped[-1]["speaker_label"] != label:
            grouped.append(
                {
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "speaker_label": label,
                    "parts": [],
                    "confidences": [],
                    "language": language,
                }
            )
        group = grouped[-1]
        group["end_ms"] = max(group["end_ms"], end_ms)
        group["parts"].append((content, getattr(result, "type", None)))
        if isinstance(confidence, (int, float)):
            group["confidences"].append(float(confidence))

    segments: list[TranscriptionSegment] = []
    for group in grouped:
        text = _join_parts(group["parts"])
        if not text:
            continue
        identified = known.get(group["speaker_label"] or "")
        confidence_values = group["confidences"]
        segments.append(
            TranscriptionSegment(
                start_ms=group["start_ms"],
                end_ms=group["end_ms"],
                text=text,
                speaker_label=group["speaker_label"],
                confidence=(
                    sum(confidence_values) / len(confidence_values)
                    if confidence_values
                    else None
                ),
                speaker_name=identified.name if identified else None,
                voice_profile_id=identified.profile_id if identified else None,
                is_identified=identified is not None,
            )
        )
    if not segments:
        raise STTProviderError(
            "Speechmatics returned no timed transcript segments.",
            code="STT_RESULT_INVALID",
            retryable=False,
        )
    return TranscriptionResult(
        default_language, tuple(segments), provider_name="speechmatics"
    )


def _join_parts(parts: list[tuple[str, str]]) -> str:
    result = ""
    for content, item_type in parts:
        if not result:
            result = content
        elif item_type == "punctuation" or content.strip() in ".,!?;:)]}" :
            result += content
        else:
            result += " " + content
    return result.strip()


def _coalesce_stream_segments(
    captured: list[tuple[str, TranscriptionSegment]],
) -> list[tuple[str, TranscriptionSegment]]:
    grouped: list[tuple[str, TranscriptionSegment]] = []
    for language, segment in captured:
        if not grouped:
            grouped.append((language, segment))
            continue
        previous_language, previous = grouped[-1]
        gap_ms = segment.start_ms - previous.end_ms
        if (
            language != previous_language
            or segment.speaker_label != previous.speaker_label
            or gap_ms > 1500
        ):
            grouped.append((language, segment))
            continue
        separator = ""
        if not segment.text.startswith((".", ",", "!", "?", ";", ":", ")", "]", "}")):
            separator = " "
        grouped[-1] = (
            language,
            TranscriptionSegment(
                start_ms=previous.start_ms,
                end_ms=max(previous.end_ms, segment.end_ms),
                text=f"{previous.text.rstrip()}{separator}{segment.text.lstrip()}",
                speaker_label=previous.speaker_label,
                confidence=previous.confidence,
                speaker_name=previous.speaker_name,
                voice_profile_id=previous.voice_profile_id,
                is_identified=previous.is_identified,
            ),
        )
    return grouped


def _milliseconds(value: Any) -> int:
    return max(0, round(float(value or 0.0) * 1000))


def _language(value: str | None) -> str:
    normalized = str(value or "vi").strip().lower().replace("_", "-").split("-", 1)[0]
    if normalized not in {"vi", "en"}:
        raise STTProviderError(
            f"Speechmatics does not support configured language '{value}'.",
            code="STT_LANGUAGE_UNSUPPORTED",
            retryable=False,
        )
    return normalized


def _provider_error(exc: Exception, *, operation: str) -> STTProviderError:
    message = str(exc).strip() or exc.__class__.__name__
    normalized = message.lower()
    nonretryable = any(
        marker in normalized
        for marker in (
            "api key",
            "unauthorized",
            "forbidden",
            "401",
            "403",
            "invalid config",
            "validation error",
        )
    )
    return STTProviderError(
        f"Speechmatics {operation} failed: {message}",
        code="STT_PROVIDER_CONFIGURATION_ERROR" if nonretryable else "STT_PROVIDER_ERROR",
        retryable=not nonretryable,
    )


def build_speechmatics_provider(settings: Settings) -> SpeechmaticsProvider:
    return SpeechmaticsProvider(settings)
