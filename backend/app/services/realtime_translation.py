"""Transient, non-blocking translation for one realtime WebSocket session."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from contextlib import suppress
from dataclasses import dataclass
from uuid import UUID

from app.providers.contracts import (
    TranscriptionSegment,
    TranslationProvider,
    TranslationProviderError,
)

SendRealtimeEvent = Callable[[dict[str, object]], Awaitable[None]]
_TRANSLATION_BATCH_SIZE = 8


@dataclass(frozen=True)
class RealtimeTranslationItem:
    logical_segment_id: UUID
    segment: TranscriptionSegment
    source_language: str | None = None


@dataclass(frozen=True)
class _QueuedTranslation:
    item: RealtimeTranslationItem
    generation: int
    source_language: str
    target_language: str


class RealtimeTranslationSession:
    """Translate final STT segments without blocking the audio receive loop."""

    def __init__(
        self,
        provider: TranslationProvider,
        source_language: str,
        send_event: SendRealtimeEvent,
    ) -> None:
        self._provider = provider
        self._source_language = source_language
        self._send_event = send_event
        self._queue: asyncio.Queue[_QueuedTranslation] = asyncio.Queue()
        self._known: dict[UUID, RealtimeTranslationItem] = {}
        self._translated: set[UUID] = set()
        self._queued: set[UUID] = set()
        self._in_flight: set[UUID] = set()
        self._worker: asyncio.Task[None] | None = None
        self._target_language: str | None = None
        self._generation = 0
        self._enabled = False
        self._closed = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def target_language(self) -> str | None:
        return self._target_language

    async def enable(
        self,
        target_language: str,
        backfill: Iterable[RealtimeTranslationItem] = (),
    ) -> None:
        if self._closed:
            return
        target_changed = self._target_language not in {None, target_language}
        if not self._enabled or target_changed:
            self._generation += 1
            self._drain_queue()
        if target_changed:
            self._translated.clear()
        self._target_language = target_language
        self._enabled = True
        self._remember(backfill)
        self._ensure_worker()
        for item in self._known.values():
            self._enqueue(item)

    async def disable(self) -> None:
        if self._enabled:
            self._generation += 1
        self._enabled = False
        self._drain_queue()

    def add_final(self, item: RealtimeTranslationItem) -> None:
        if self._closed:
            return
        self._known[item.logical_segment_id] = item
        if self._enabled:
            self._enqueue(item)

    async def flush(self, timeout_seconds: float = 15.0) -> None:
        if not self._enabled or self._worker is None:
            return
        with suppress(TimeoutError):
            await asyncio.wait_for(self._queue.join(), timeout=timeout_seconds)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self.disable()
        if self._worker is not None:
            self._worker.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self._worker
            self._worker = None

    def _remember(self, items: Iterable[RealtimeTranslationItem]) -> None:
        for item in items:
            # A live final event may already contain the detected language. Do not
            # replace it with a language-less database backfill item.
            self._known.setdefault(item.logical_segment_id, item)

    def _enqueue(self, item: RealtimeTranslationItem) -> None:
        target = self._target_language
        logical_id = item.logical_segment_id
        if (
            not self._enabled
            or target is None
            or logical_id in self._translated
            or logical_id in self._queued
            or logical_id in self._in_flight
        ):
            return
        source = self._source_language
        if source == "auto":
            source = _normalized_language(item.source_language)
        if source not in {"vi", "en"}:
            return
        if target == "auto":
            target = _opposite_language(source)
        if target is None or target == source:
            return
        self._queued.add(logical_id)
        self._queue.put_nowait(
            _QueuedTranslation(item, self._generation, source, target)
        )

    def _ensure_worker(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="realtime-translation")

    def _drain_queue(self) -> None:
        while True:
            try:
                queued = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._queued.discard(queued.item.logical_segment_id)
            self._queue.task_done()

    async def _run(self) -> None:
        while True:
            first = await self._queue.get()
            batch = [first]
            while len(batch) < _TRANSLATION_BATCH_SIZE:
                try:
                    batch.append(self._queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
            try:
                await self._translate_batch(batch)
            finally:
                for queued in batch:
                    logical_id = queued.item.logical_segment_id
                    stale = queued.generation != self._generation
                    self._queued.discard(logical_id)
                    self._in_flight.discard(logical_id)
                    self._queue.task_done()
                    if stale and self._enabled and logical_id in self._known:
                        self._enqueue(self._known[logical_id])

    async def _translate_batch(self, batch: list[_QueuedTranslation]) -> None:
        current = [
            queued
            for queued in batch
            if self._enabled
            and queued.generation == self._generation
        ]
        if not current:
            return
        for queued in current:
            self._in_flight.add(queued.item.logical_segment_id)
        grouped: dict[tuple[str, str], list[_QueuedTranslation]] = {}
        for queued in current:
            grouped.setdefault(
                (queued.source_language, queued.target_language), []
            ).append(queued)
        for (source, target), language_batch in grouped.items():
            try:
                translated = await self._provider.translate_segments(
                    tuple(queued.item.segment for queued in language_batch),
                    source,
                    target,
                )
                if len(translated) != len(language_batch):
                    raise TranslationProviderError(
                        "The translation provider returned invalid segment alignment.",
                        code="TRANSLATION_RESULT_INVALID",
                        retryable=False,
                    )
            except TranslationProviderError as exc:
                await self._emit_error(
                    language_batch, exc.code, str(exc), exc.retryable
                )
                continue
            except Exception:
                await self._emit_error(
                    language_batch,
                    "TRANSLATION_PROVIDER_ERROR",
                    "Realtime translation could not process these transcript segments.",
                    True,
                )
                continue
            if not self._enabled or language_batch[0].generation != self._generation:
                continue
            for queued, result in zip(language_batch, translated, strict=True):
                logical_id = queued.item.logical_segment_id
                self._translated.add(logical_id)
                await self._safe_send(
                    {
                        "type": "translation.final",
                        "logical_segment_id": str(logical_id),
                        "source_language": queued.source_language,
                        "target_language": queued.target_language,
                        "text": result.text,
                    }
                )

    async def _emit_error(
        self,
        batch: list[_QueuedTranslation],
        code: str,
        message: str,
        retryable: bool,
    ) -> None:
        if not batch or batch[0].generation != self._generation or not self._enabled:
            return
        await self._safe_send(
            {
                "type": "translation.error",
                "code": code,
                "message": message,
                "retryable": retryable,
                "logical_segment_ids": [
                    str(queued.item.logical_segment_id) for queued in batch
                ],
            }
        )

    async def _safe_send(self, payload: dict[str, object]) -> None:
        with suppress(Exception):
            await self._send_event(payload)


def _normalized_language(language: str | None) -> str | None:
    if not language:
        return None
    normalized = language.strip().lower().replace("_", "-").split("-", 1)[0]
    return normalized or None


def _opposite_language(language: str) -> str | None:
    return {"vi": "en", "en": "vi"}.get(language)
