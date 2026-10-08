"""AssemblyAI adapters mapped to the application's STT contracts.

The batch API receives a normalized WAV uploaded by the media worker.  The
streaming API is deliberately server-to-server: AssemblyAI credentials never
reach the browser.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import Settings
from app.providers.contracts import (
    KnownSpeaker,
    StreamingEvent,
    StreamingOptions,
    StreamingSpeakerRevision,
    StreamingTranscriptionEvent,
    STTCapabilities,
    STTProviderError,
    TranscriptionResult,
    TranscriptionSegment,
)


class AssemblyAIProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        if not settings.stt_api_key:
            raise ValueError("STT_API_KEY is required when STT_PROVIDER=assemblyai.")
        self._key = settings.stt_api_key
        self._model = settings.stt_model
        self._api_base_url = settings.assemblyai_api_base_url.rstrip("/")
        self._streaming_base_url = settings.assemblyai_streaming_base_url.rstrip("/")
        self._streaming_model = settings.assemblyai_streaming_model
        self._streaming_mode = settings.assemblyai_streaming_mode
        self._poll_interval = settings.stt_poll_interval_seconds
        self._poll_timeout = settings.stt_poll_timeout_seconds
        self._client = client

    def capabilities(self) -> STTCapabilities:
        return STTCapabilities(True, True, True, True, True, frozenset({"vi", "en"}), True)

    async def transcribe_file(
        self,
        source: Path,
        language: str | None = None,
        known_speakers: tuple[KnownSpeaker, ...] = (),
    ) -> TranscriptionResult:
        if not source.is_file():
            raise STTProviderError("Normalized media is unavailable.", code="STT_MEDIA_UNAVAILABLE", retryable=False)
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))
        try:
            upload = await client.post(
                f"{self._api_base_url}/upload",
                headers={"authorization": self._key, "content-type": "application/octet-stream"},
                content=await asyncio.to_thread(source.read_bytes),
            )
            upload_url = self._response_json(upload).get("upload_url")
            if not isinstance(upload_url, str):
                raise STTProviderError("AssemblyAI did not return an upload URL.", code="STT_RESULT_INVALID", retryable=False)
            submitted = await client.post(
                f"{self._api_base_url}/transcript",
                headers={"authorization": self._key},
                json={
                    "audio_url": upload_url,
                    "speech_models": [self._model],
                    "speaker_labels": True,
                    **({"language_code": language} if language in {"vi", "en"} else {}),
                },
            )
            transcript_id = self._response_json(submitted).get("id")
            if not isinstance(transcript_id, str):
                raise STTProviderError("AssemblyAI did not accept the transcript.", code="STT_RESULT_INVALID", retryable=False)
            deadline = time.monotonic() + self._poll_timeout
            while time.monotonic() < deadline:
                response = await client.get(
                    f"{self._api_base_url}/transcript/{transcript_id}",
                    headers={"authorization": self._key},
                )
                payload = self._response_json(response)
                state = payload.get("status")
                if state == "completed":
                    return _batch_result(payload)
                if state == "error":
                    raise STTProviderError(str(payload.get("error") or "AssemblyAI transcription failed."), code="STT_TRANSCRIPTION_FAILED", retryable=False)
                await asyncio.sleep(self._poll_interval)
            raise STTProviderError("AssemblyAI transcription timed out.", code="STT_TIMEOUT", retryable=True)
        finally:
            if owns_client:
                await client.aclose()

    async def open_stream(self, options: StreamingOptions) -> "AssemblyAIStream":
        return await AssemblyAIStream.connect(
            self._key,
            self._streaming_base_url,
            self._streaming_model,
            self._streaming_mode,
            options,
        )

    @staticmethod
    def _response_json(response: httpx.Response) -> dict[str, Any]:
        if response.is_error:
            retryable = response.status_code >= 500 or response.status_code == 429
            raise STTProviderError("AssemblyAI request failed.", code="STT_PROVIDER_HTTP_ERROR", retryable=retryable)
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise STTProviderError("AssemblyAI returned an invalid response.", code="STT_RESULT_INVALID", retryable=True) from exc
        if not isinstance(payload, dict):
            raise STTProviderError("AssemblyAI returned an invalid response.", code="STT_RESULT_INVALID", retryable=True)
        return payload


class AssemblyAIStream:
    provider_name = "assemblyai"
    speaker_identification_available = False
    fallback_active = False

    def __init__(self, websocket: Any, language: str, diarization: bool = False) -> None:
        self._websocket = websocket
        self._language = language
        self._diarization = diarization
        self._final_turns: set[int] = set()
        self._events: deque[StreamingEvent] = deque()
        self._failure: STTProviderError | None = None
        self._terminated = asyncio.Event()
        self._closing = False
        self._closed = False
        self._reader = asyncio.create_task(self._read())

    @classmethod
    async def connect(
        cls,
        api_key: str,
        streaming_base_url: str,
        streaming_model: str,
        streaming_mode: str,
        options: StreamingOptions,
    ) -> "AssemblyAIStream":
        websocket: Any | None = None
        try:
            import websockets

            language = _streaming_language_code(options.language)
            query = urlencode(
                {
                    "sample_rate": 16000,
                    "speech_model": streaming_model,
                    "mode": streaming_mode,
                    "format_turns": "true",
                    "speaker_labels": str(options.diarization).lower(),
                    **({"speaker_labels_revision_interval_ms": 300000}
                       if options.diarization else {}),
                    "language_codes": [language],
                    "prompt": _streaming_language_prompt(language),
                },
                doseq=True,
            )
            websocket = await websockets.connect(
                f"{streaming_base_url}?{query}",
                additional_headers={"Authorization": api_key},
                ping_interval=20,
                ping_timeout=20,
            )
            raw = await asyncio.wait_for(websocket.recv(), timeout=10)
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise STTProviderError(
                    "AssemblyAI returned an invalid streaming handshake.",
                    code="STT_STREAM_HANDSHAKE_INVALID",
                    retryable=True,
                )
            if payload.get("type") == "Error":
                raise _stream_provider_error(payload, during_connect=True)
            if payload.get("type") != "Begin":
                raise STTProviderError(
                    "AssemblyAI did not start the streaming session.",
                    code="STT_STREAM_HANDSHAKE_INVALID",
                    retryable=True,
                )
            return cls(websocket, language, options.diarization)
        except STTProviderError:
            if websocket is not None:
                await websocket.close()
            raise
        except TimeoutError as exc:
            if websocket is not None:
                await websocket.close()
            raise STTProviderError(
                "AssemblyAI timed out while starting the streaming session.",
                code="STT_STREAM_CONNECT_TIMEOUT",
                retryable=True,
            ) from exc
        except Exception as exc:
            if websocket is not None:
                await websocket.close()
            raise STTProviderError(
                "Could not open the AssemblyAI streaming session.",
                code="STT_STREAM_CONNECT_FAILED",
                retryable=True,
            ) from exc

    async def _read(self) -> None:
        try:
            async for raw in self._websocket:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    continue
                event_type = payload.get("type")
                if event_type == "Error":
                    self._failure = _stream_provider_error(payload)
                    return
                if event_type == "Termination":
                    if not self._closing:
                        self._failure = STTProviderError(
                            "AssemblyAI ended the streaming session unexpectedly.",
                            code="STT_STREAM_INTERRUPTED",
                            retryable=True,
                        )
                    return
                if event_type == "SpeakerRevision":
                    revisions = payload.get("revisions")
                    if self._diarization and isinstance(revisions, list):
                        for revision in revisions:
                            if not isinstance(revision, dict):
                                continue
                            order = revision.get("turn_order")
                            if type(order) is int and order >= 0 and "speaker_label" in revision:
                                self._events.append(StreamingSpeakerRevision(
                                    order, _speaker_label(revision.get("speaker_label"))
                                ))
                    continue
                event = _stream_event(payload, self._language, self._diarization)
                if event is not None:
                    if event.turn_order is not None:
                        if event.turn_order in self._final_turns:
                            continue
                        if event.type == "final":
                            self._final_turns.add(event.turn_order)
                    self._events.append(event)
        except asyncio.CancelledError:
            raise
        except json.JSONDecodeError:
            self._failure = STTProviderError(
                "AssemblyAI returned an invalid streaming event.",
                code="STT_STREAM_EVENT_INVALID",
                retryable=True,
            )
        except Exception as exc:
            if not self._closing:
                close_code = getattr(exc, "code", None)
                close_reason = str(getattr(exc, "reason", "") or "").strip()
                detail = f" (close code {close_code})" if close_code is not None else ""
                if close_reason:
                    detail += f": {close_reason}"
                self._failure = STTProviderError(
                    f"AssemblyAI closed the streaming session{detail}.",
                    code="STT_STREAM_INTERRUPTED",
                    retryable=close_code != 3006,
                )
        finally:
            self._terminated.set()

    async def send_audio(self, chunk: bytes) -> tuple[StreamingEvent, ...]:
        if self._closed or self._closing:
            raise STTProviderError(
                "The realtime session is closed.", code="STT_STREAM_CLOSED", retryable=False
            )
        self._raise_failure()
        if self._reader.done():
            raise STTProviderError(
                "AssemblyAI ended the streaming session unexpectedly.",
                code="STT_STREAM_INTERRUPTED",
                retryable=True,
            )
        try:
            await self._websocket.send(chunk)
            await asyncio.sleep(0)
        except Exception as exc:
            self._raise_failure()
            raise STTProviderError(
                "AssemblyAI lost the streaming session.",
                code="STT_STREAM_INTERRUPTED",
                retryable=True,
            ) from exc
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
        self._closing = True
        try:
            try:
                await self._websocket.send(json.dumps({"type": "Terminate"}))
            except Exception as exc:
                if self._failure is None:
                    self._failure = STTProviderError(
                        "AssemblyAI lost the streaming session while stopping.",
                        code="STT_STREAM_INTERRUPTED",
                        retryable=True,
                    )
                raise self._failure from exc
            try:
                await asyncio.wait_for(self._terminated.wait(), timeout=5)
            except TimeoutError as exc:
                self._failure = STTProviderError(
                    "AssemblyAI did not finish the streaming session in time.",
                    code="STT_STREAM_CLOSE_TIMEOUT",
                    retryable=True,
                )
                raise self._failure from exc
        finally:
            await self._websocket.close()
            if not self._reader.done():
                self._reader.cancel()
            await asyncio.gather(self._reader, return_exceptions=True)
            self._closed = True
        self._raise_failure()
        return self._drain()

    def _raise_failure(self) -> None:
        if self._failure is not None:
            raise self._failure

    def _drain(self) -> tuple[StreamingEvent, ...]:
        events = tuple(self._events)
        self._events.clear()
        return events


def _stream_provider_error(
    payload: dict[str, Any], *, during_connect: bool = False
) -> STTProviderError:
    message = str(payload.get("error") or payload.get("message") or "AssemblyAI rejected the streaming session.")
    normalized = message.lower()
    retryable = not any(
        marker in normalized
        for marker in ("user input validation", "invalid", "unauthorized", "forbidden", "api key")
    )
    return STTProviderError(
        message,
        code="STT_STREAM_REJECTED" if during_connect else "STT_STREAM_PROVIDER_ERROR",
        retryable=retryable,
    )

def _streaming_language_prompt(language: str) -> str:
    language_name = {"vi": "Vietnamese", "en": "English"}.get(language, language)
    return (
        f"Transcribe {language_name}. Transcribe verbatim with standard punctuation. "
        "Keep the spoken language and do not translate it."
    )


def _streaming_language_code(language: str) -> str:
    normalized = language.strip().lower().replace("_", "-").split("-", 1)[0]
    if normalized not in {"vi", "en"}:
        raise STTProviderError(
            f"Realtime transcription does not support language '{language}'.",
            code="STT_LANGUAGE_UNSUPPORTED",
            retryable=False,
        )
    return normalized


def _batch_result(payload: dict[str, Any]) -> TranscriptionResult:
    utterances = payload.get("utterances")
    source = utterances if isinstance(utterances, list) and utterances else payload.get("words", [])
    segments: list[TranscriptionSegment] = []
    for item in source:
        if not isinstance(item, dict):
            continue
        text = item.get("text") or item.get("word")
        start, end = item.get("start"), item.get("end")
        if isinstance(text, str) and text.strip() and isinstance(start, int) and isinstance(end, int) and end > start:
            label = item.get("speaker")
            confidence = item.get("confidence")
            segments.append(TranscriptionSegment(start, end, text.strip(), str(label) if label is not None else None, float(confidence) if isinstance(confidence, (int, float)) else None))
    if not segments:
        raise STTProviderError("AssemblyAI returned no timed transcript segments.", code="STT_RESULT_INVALID", retryable=False)
    language = str(payload.get("language_code") or "und").split("_")[0].lower()
    return TranscriptionResult(language, tuple(segments), provider_name="assemblyai")


def _speaker_label(value: Any) -> str | None:
    # PENDING/UNKNOWN identify unassigned speech, not actual speakers.
    if isinstance(value, str) and len(value) == 1 and "A" <= value <= "Z":
        return value
    return None


def _stream_event(
    payload: Any, default_language: str = "und", diarization: bool = True
) -> StreamingTranscriptionEvent | None:
    if not isinstance(payload, dict) or payload.get("type") != "Turn" or not str(payload.get("transcript", "")).strip():
        return None
    words = payload.get("words") if isinstance(payload.get("words"), list) else []
    first, last = (words[0], words[-1]) if words else ({}, {})
    start, end = first.get("start", 0), last.get("end", max(1, int(first.get("start", 0)) + 1))
    if not isinstance(start, int) or not isinstance(end, int) or end <= start:
        return None
    confidence = payload.get("end_of_turn_confidence", payload.get("confidence"))
    order = payload.get("turn_order")
    return StreamingTranscriptionEvent(
        "final" if payload.get("end_of_turn") else "partial",
        str(payload.get("language_code") or default_language),
        TranscriptionSegment(
            start, end, str(payload["transcript"]).strip(),
            speaker_label=_speaker_label(payload.get("speaker_label")) if diarization else None,
            confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
        ),
        turn_order=order if type(order) is int and order >= 0 else None,
    )


def build_assemblyai_provider(settings: Settings) -> AssemblyAIProvider:
    return AssemblyAIProvider(settings)
