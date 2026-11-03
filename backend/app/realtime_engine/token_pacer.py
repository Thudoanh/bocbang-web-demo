"""ChatGPT-Style Typewriter Token Pacing Queue.

Smooths out bursty 250ms ASR / Translation outputs into a steady stream of tokens
with dynamic adaptive drain speed and typewriter cursor indicator.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import AsyncGenerator, Callable, Coroutine

logger = logging.getLogger(__name__)

CURSOR_CHAR = "▋"


class TokenPacerQueue:
    """Adaptive Token Pacer for ChatGPT-style word-by-word streaming."""

    def __init__(
        self,
        base_drain_interval_s: float = 0.030,   # 30ms for standard smooth pacing
        medium_drain_interval_s: float = 0.018, # 18ms when queue starts building
        fast_drain_interval_s: float = 0.010,   # 10ms fast-forward when speech is fast
        on_emit: Callable[[str, str, bool], Coroutine[None, None, None]] | None = None,
    ):
        self.base_interval = base_drain_interval_s
        self.medium_interval = medium_drain_interval_s
        self.fast_interval = fast_drain_interval_s
        self.on_emit = on_emit

        self._queue: deque[str] = deque()
        self._displayed_tokens: list[str] = []
        self._is_active = False
        self._worker_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def start(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._is_active = True
            self._worker_task = asyncio.create_task(self._drain_loop(), name="token-pacer-drain")

    async def stop(self) -> None:
        self._is_active = False
        if self._worker_task:
            self._worker_task.cancel()
            self._worker_task = None
        self.reset()

    def reset(self) -> None:
        self._queue.clear()
        self._displayed_tokens.clear()

    def push_tokens(self, tokens: list[str]) -> None:
        """Enqueue new delta tokens into the pacing queue."""
        for t in tokens:
            cleaned = t.strip()
            if cleaned:
                self._queue.append(cleaned)

    def get_current_display(self, show_cursor: bool = True) -> str:
        """Get the full currently rendered text with optional typing cursor."""
        text = " ".join(self._displayed_tokens).strip()
        if show_cursor and (self._is_active or len(self._queue) > 0):
            return f"{text} {CURSOR_CHAR}".strip()
        return text

    def flush_all(self) -> list[str]:
        """Immediately drain all pending tokens (e.g. on clause finalization)."""
        drained: list[str] = []
        while self._queue:
            token = self._queue.popleft()
            self._displayed_tokens.append(token)
            drained.append(token)
        return drained

    async def _drain_loop(self) -> None:
        """High-frequency adaptive drain loop."""
        while self._is_active:
            try:
                q_len = len(self._queue)
                if q_len == 0:
                    await asyncio.sleep(0.015)
                    continue

                # Adaptive pace calculation
                if q_len <= 3:
                    interval = self.base_interval
                elif q_len <= 8:
                    interval = self.medium_interval
                else:
                    interval = self.fast_interval

                token = self._queue.popleft()
                self._displayed_tokens.append(token)

                if self.on_emit:
                    current_text = " ".join(self._displayed_tokens).strip()
                    try:
                        await self.on_emit(token, current_text, False)
                    except Exception as err:
                        logger.error("Token pacer emit callback error: %s", err)

                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Token pacer error: %s", exc)
                await asyncio.sleep(0.02)
