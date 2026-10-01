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
    STTCapabilities,
    STTProviderError,
    StreamingOptions,
    StreamingTranscriptionEvent,
    TranscriptionResult,
    TranscriptionSegment,
)


class AssemblyAIProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        if not settings.stt_api_key:
            raise ValueError("STT_API_KEY is required when STT_PROVIDER=assemblyai.")
        self._key = settings.stt_api_key
        self._root = settings.media_storage_path.resolve()
        self._model = settings.stt_model
        self._api_base_url = settings.assemblyai_api_base_url.rstrip("/")
        self._streaming_base_url = settings.assemblyai_streaming_base_url.rstrip("/")
        self._poll_interval = settings.stt_poll_interval_seconds
        self._poll_timeout = settings.stt_poll_timeout_seconds
        self._client = client

    def capabilities(self) -> STTCapabilities:
        return STTCapabilities(True, True, True, True, True, frozenset({"vi", "en"}), True)

    async def transcribe_file(self, media_key: str) -> TranscriptionResult:
        path = (self._root / media_key).resolve()
        if self._root not in path.parents or not path.is_file():
            raise STTProviderError("Normalized media is unavailable.", code="STT_MEDIA_UNAVAILABLE", retryable=False)
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))
        try:
            upload = await client.post(
                f"{self._api_base_url}/upload",
                headers={"authorization": self._key, "content-type": "application/octet-stream"},
                content=await asyncio.to_thread(path.read_bytes),
            )
            upload_url = self._response_json(upload).get("upload_url")
            if not isinstance(upload_url, str):
                raise STTProviderError("AssemblyAI did not return an upload URL.", code="STT_RESULT_INVALID", retryable=False)
            submitted = await client.post(
                f"{self._api_base_url}/transcript",
                headers={"authorization": self._key},
                json={"audio_url": upload_url, "speech_models": [self._model], "speaker_labels": True},
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
        return await AssemblyAIStream.connect(self._key, self._streaming_base_url, options)

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
    def __init__(self, websocket: Any, task: asyncio.Task[None]) -> None:
        self._websocket, self._reader = websocket, task
        self._events: deque[StreamingTranscriptionEvent] = deque()
        self._closed = False

    @classmethod
    async def connect(
        cls, api_key: str, streaming_base_url: str, options: StreamingOptions
    ) -> "AssemblyAIStream":
        try:
            import websockets

            query = urlencode({"sample_rate": 16000, "speech_model": "universal-3-pro", "format_turns": "true"})
            websocket = await websockets.connect(
                f"{streaming_base_url}?{query}",
                additional_headers={"Authorization": api_key}, ping_interval=20, ping_timeout=20,
            )
        except Exception as exc:
            raise STTProviderError("Could not open the AssemblyAI streaming session.", code="STT_STREAM_CONNECT_FAILED", retryable=True) from exc
        stream = cls(websocket, asyncio.create_task(asyncio.sleep(0)))
        stream._reader = asyncio.create_task(stream._read())
        return stream

    async def _read(self) -> None:
        try:
            async for raw in self._websocket:
                payload = json.loads(raw)
                event = _stream_event(payload)
                if event:
                    self._events.append(event)
        except Exception:
            # The next caller gets a retryable send/close error; never fabricate text.
            return

    async def send_audio(self, chunk: bytes) -> tuple[StreamingTranscriptionEvent, ...]:
        if self._closed:
            raise STTProviderError("The realtime session is closed.", code="STT_STREAM_CLOSED", retryable=False)
        try:
            await self._websocket.send(chunk)
            await asyncio.sleep(0)
        except Exception as exc:
            raise STTProviderError("AssemblyAI lost the streaming session.", code="STT_STREAM_INTERRUPTED", retryable=True) from exc
        return self._drain()

    async def pause(self) -> tuple[StreamingTranscriptionEvent, ...]:
        return self._drain()

    async def resume(self) -> tuple[StreamingTranscriptionEvent, ...]:
        return self._drain()

    async def close(self) -> tuple[StreamingTranscriptionEvent, ...]:
        if not self._closed:
            self._closed = True
            try:
                await self._websocket.send(json.dumps({"type": "Terminate"}))
                await asyncio.sleep(0.1)
            finally:
                await self._websocket.close()
                self._reader.cancel()
        return self._drain()

    def _drain(self) -> tuple[StreamingTranscriptionEvent, ...]:
        events = tuple(event for event in self._events if event.segment.text.strip())
        self._events.clear()
        return events


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
    return TranscriptionResult(language, tuple(segments))


def _stream_event(payload: Any) -> StreamingTranscriptionEvent | None:
    if not isinstance(payload, dict) or payload.get("type") != "Turn" or not str(payload.get("transcript", "")).strip():
        return None
    words = payload.get("words") if isinstance(payload.get("words"), list) else []
    first, last = (words[0], words[-1]) if words else ({}, {})
    start, end = first.get("start", 0), last.get("end", max(1, int(first.get("start", 0)) + 1))
    if not isinstance(start, int) or not isinstance(end, int) or end <= start:
        return None
    return StreamingTranscriptionEvent("final" if payload.get("end_of_turn") else "partial", str(payload.get("language_code") or "und"), TranscriptionSegment(start, end, str(payload["transcript"]).strip(), confidence=float(payload["confidence"]) if isinstance(payload.get("confidence"), (int, float)) else None))


def build_assemblyai_provider(settings: Settings) -> AssemblyAIProvider:
    return AssemblyAIProvider(settings)
