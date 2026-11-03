"""In-memory pub/sub broker to broadcast live meeting events to viewer websockets."""

from __future__ import annotations

import asyncio
from collections import defaultdict
import logging
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)


class MeetingBroadcaster:
    """Manages viewer WebSocket subscriptions for live meeting events."""

    def __init__(self) -> None:
        self._subscribers: dict[UUID, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._translations: dict[UUID, dict[str, str]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    def record_translation(self, meeting_id: UUID, seg_id: str, text: str) -> None:
        self._translations[meeting_id][seg_id] = text

    def set_translation(self, meeting_id: UUID, seg_id: str, text: str) -> None:
        self.record_translation(meeting_id, seg_id, text)

    def get_translations(self, meeting_id: UUID) -> dict[str, str]:
        return dict(self._translations.get(meeting_id, {}))

    async def subscribe(self, meeting_id: UUID) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=300)
        async with self._lock:
            self._subscribers[meeting_id].add(queue)
            logger.info(
                "Viewer subscribed to meeting=%s (total viewers: %d)",
                meeting_id,
                len(self._subscribers[meeting_id]),
            )
        return queue

    async def unsubscribe(self, meeting_id: UUID, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            if meeting_id in self._subscribers:
                self._subscribers[meeting_id].discard(queue)
                if not self._subscribers[meeting_id]:
                    del self._subscribers[meeting_id]
            logger.info("Viewer unsubscribed from meeting=%s", meeting_id)

    async def broadcast(self, meeting_id: UUID, payload: dict[str, Any]) -> None:
        if payload.get("type") == "translation.final":
            seg_id = str(payload.get("logical_segment_id") or "")
            text = str(payload.get("text") or "")
            if seg_id and text:
                self.record_translation(meeting_id, seg_id, text)

        async with self._lock:
            queues = list(self._subscribers.get(meeting_id, ()))
        if not queues:
            return
        for q in queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    pass


meeting_broadcaster = MeetingBroadcaster()
