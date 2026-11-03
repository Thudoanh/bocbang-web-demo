"""Transient, non-blocking translation for one realtime WebSocket session."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Iterable
from contextlib import suppress
from dataclasses import dataclass
from uuid import UUID

from app.core.logging import get_logger
from app.providers.contracts import (
    TranscriptionSegment,
    TranslationProvider,
    TranslationProviderError,
)

logger = get_logger(__name__)

SendRealtimeEvent = Callable[[dict[str, object]], Awaitable[None]]
_TRANSLATION_BATCH_SIZE = 8


@dataclass(frozen=True)
class RealtimeTranslationItem:
    logical_segment_id: UUID
    segment: TranscriptionSegment


@dataclass(frozen=True)
class _QueuedTranslation:
    item: RealtimeTranslationItem
    generation: int
    target_language: str


class RealtimeTranslationSession:
    """Translate final STT segments without blocking the audio receive loop."""

    def __init__(
        self,
        provider: TranslationProvider,
        source_language: str,
        send_event: SendRealtimeEvent,
        fallback_provider: TranslationProvider | None = None,
    ) -> None:
        self._provider, self._fallback_provider = provider, fallback_provider
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
        self._partial_generation: dict[str, int] = {}
        self._partial_tasks: dict[str, asyncio.Task[None]] = {}

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
        source_language: str | None = None,
    ) -> None:
        if self._closed:
            return
        if source_language:
            self._source_language = source_language
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
        old_item = self._known.get(item.logical_segment_id)
        if old_item is not None and old_item.segment.text != item.segment.text:
            self._translated.discard(item.logical_segment_id)
        self._known[item.logical_segment_id] = item
        if self._enabled:
            self._enqueue(item)

    def add_partial(self, stream_segment_id: str, segment: TranscriptionSegment) -> None:
        """Translate the newest interim snapshot without delaying audio/STT."""
        if self._closed or not self._enabled or not self._target_language or not segment.text.strip():
            return
        generation = self._partial_generation.get(stream_segment_id, 0) + 1
        self._partial_generation[stream_segment_id] = generation
        previous = self._partial_tasks.get(stream_segment_id)
        if previous is not None:
            previous.cancel()
        task = asyncio.create_task(
            self._translate_partial(stream_segment_id, segment, generation, self._target_language),
            name="realtime-partial-translation",
        )
        self._partial_tasks[stream_segment_id] = task

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
        for task in self._partial_tasks.values():
            task.cancel()
        if self._partial_tasks:
            await asyncio.gather(*self._partial_tasks.values(), return_exceptions=True)
        self._partial_tasks.clear()

    def _remember(self, items: Iterable[RealtimeTranslationItem]) -> None:
        for item in items:
            self._known[item.logical_segment_id] = item

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
        self._queued.add(logical_id)
        self._queue.put_nowait(_QueuedTranslation(item, self._generation, target))

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
                    latest = self._known.get(logical_id)
                    changed = latest is not None and latest.segment != queued.item.segment
                    if (stale or changed) and self._enabled and latest is not None:
                        if changed:
                            self._translated.discard(logical_id)
                        self._enqueue(self._known[logical_id])
                    self._queue.task_done()

    async def _translate_batch(self, batch: list[_QueuedTranslation]) -> None:
        current = [
            queued
            for queued in batch
            if self._enabled
            and queued.generation == self._generation
            and queued.target_language == self._target_language
        ]
        if not current:
            return
        for queued in current:
            self._in_flight.add(queued.item.logical_segment_id)

        async def _translate_single(q: _QueuedTranslation):
            seg = q.item.segment
            target = "en" if _probably_vietnamese(seg.text) else "vi"
            src_lang = "vi" if target == "en" else "auto"
            try:
                res = await self._translate_with_fallbacks((seg,), target, src_lang=src_lang)
                return q, res[0], target
            except Exception as e:
                logger.warning("Segment translation fallback failed for %s: %s", q.item.logical_segment_id, e)
                return q, None, target

        results = await asyncio.gather(*[_translate_single(q) for q in current])

        if (
            not self._enabled
            or current[0].generation != self._generation
            or current[0].target_language != self._target_language
        ):
            return
        for queued, result, eff_target in results:
            logical_id = queued.item.logical_segment_id
            latest = self._known.get(logical_id)
            if latest is not None and latest.segment != queued.item.segment:
                continue
            if result is not None and result.text.strip():
                self._translated.add(logical_id)
                await self._safe_send(
                    {
                        "type": "translation.final",
                        "logical_segment_id": str(logical_id),
                        "source_language": "vi" if eff_target == "en" else "en",
                        "target_language": eff_target,
                        "text": result.text.strip(),
                    }
                )
            else:
                await self._emit_error(
                    [queued], "TRANSLATION_PROVIDER_ERROR",
                    "The translation providers could not translate this segment.", True,
                )

    async def _translate_partial(
        self,
        stream_segment_id: str,
        segment: TranscriptionSegment,
        generation: int,
        target_language: str,
    ) -> None:
        try:
            # Coalesce the provider's rapid revised partial snapshots.  This
            # produces a fresh word-level translation about every 200ms without
            # putting an HTTP call in the websocket audio receive path.
            await asyncio.sleep(0.2)
            if generation != self._partial_generation.get(stream_segment_id):
                return
            eff_target = "en" if _probably_vietnamese(segment.text) else "vi"
            src_lang = "vi" if eff_target == "en" else "auto"
            result = await self._translate_with_fallbacks((segment,), eff_target, src_lang=src_lang)
            if (
                generation == self._partial_generation.get(stream_segment_id)
                and self._enabled
                and result
                and result[0].text.strip()
            ):
                await self._safe_send({
                    "type": "translation.partial",
                    "source_text": segment.text,
                    "stream_segment_id": stream_segment_id,
                    "source_language": "vi" if eff_target == "en" else "en",
                    "target_language": eff_target,
                    "text": result[0].text.strip(),
                })
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Realtime partial translation failed: %s", exc)
        finally:
            current = self._partial_tasks.get(stream_segment_id)
            if current is asyncio.current_task():
                self._partial_tasks.pop(stream_segment_id, None)

    async def _translate_with_fallbacks(
        self,
        segments: tuple[TranscriptionSegment, ...],
        target_language: str,
        src_lang: str | None = None,
    ) -> tuple[TranscriptionSegment, ...]:
        """Try primary -> Groq -> Google without ever sending a source echo."""
        from app.providers.google_translate import GoogleTranslateProvider

        source_language = src_lang or self._source_language or "auto"
        errors: list[str] = []
        providers: tuple[TranslationProvider, ...] = tuple(
            provider
            for provider in (self._provider, self._fallback_provider, GoogleTranslateProvider())
            if provider is not None
        )
        for provider in providers:
            try:
                result = await provider.translate_segments(
                    segments, source_language, target_language
                )
                if len(result) != len(segments):
                    raise ValueError("invalid segment alignment")
                if all(
                    not _translation_is_source_echo(source.text, translated.text)
                    for source, translated in zip(segments, result, strict=True)
                ):
                    return result
                errors.append(f"{type(provider).__name__} returned source text")
            except Exception as exc:
                errors.append(f"{type(provider).__name__}: {exc}")
        raise TranslationProviderError(
            "; ".join(errors) or "translation unavailable",
            code="TRANSLATION_INCOMPLETE",
            retryable=True,
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


def _translation_is_source_echo(source: str, translated: str) -> bool:
    original = re.sub(r"\s+", " ", str(source or "")).strip().casefold()
    candidate = re.sub(r"\s+", " ", str(translated or "")).strip().casefold()
    if not candidate or candidate == "...":
        return True
    compact_original = re.sub(r"[^\wà-ỹđ]", "", original)
    compact_candidate = re.sub(r"[^\wà-ỹđ]", "", candidate)
    return len(compact_original) >= 4 and compact_original == compact_candidate

_VIETNAMESE_CHARS = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
_VIETNAMESE_WORDS_REGEX = re.compile(
    r"\b(và|của|là|được|không|tôi|em|anh|chị|mọi|người|xin|chào|cảm|ơn|có|thì|với|trong|này|đó|cho|đã|sẽ|rồi|nhé|gì|nào|sao|đây|chúng|bạn|họ|nói|biết|làm)\b",
    re.IGNORECASE,
)


def _probably_vietnamese(text: str) -> bool:
    value = text.casefold()
    if any(c in value for c in _VIETNAMESE_CHARS):
        return True
    return bool(_VIETNAMESE_WORDS_REGEX.search(value))
