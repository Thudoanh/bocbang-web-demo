"""Longest Common Prefix (LCP) Delta Diffing for Smooth Streaming ASR.

Eliminates screen flicker by separating streaming transcription into:
1. locked_prefix: Confirmed and stabilized words (never re-rendered).
2. delta_append: Newly emerged words (routed to ChatGPT-style typewriter queue).
3. mutable_tail: At most 1-2 words at the very edge currently being articulated.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
import re

logger = logging.getLogger(__name__)


@dataclass
class StreamDiffResult:
    locked_prefix: str
    delta_append: list[str]
    mutable_tail: str
    full_display_text: str
    is_clause_end: bool = False


class SmoothStreamDiffer:
    """Computes Word-Level LCP and manages token stability to prevent text fluttering."""

    def __init__(self, max_mutable_tail_words: int = 2, stability_ticks_to_lock: int = 2):
        self.max_mutable_tail_words = max_mutable_tail_words
        self.stability_ticks_to_lock = stability_ticks_to_lock

        self._locked_words: list[str] = []
        self._previous_tentative: list[str] = []
        self._word_stability: list[int] = []  # Count of consecutive ticks each word remained stable

    def reset(self) -> None:
        """Reset state at turn or clause boundary."""
        self._locked_words.clear()
        self._previous_tentative.clear()
        self._word_stability.clear()

    @staticmethod
    def _clean(word: str) -> str:
        return re.sub(r"[^\w\s]", "", word).strip().lower()

    def process(self, confirmed_words: list[str], raw_tentative_words: list[str]) -> StreamDiffResult:
        """Diff new ASR output against existing state using word-level LCP."""
        # 1. Any words explicitly confirmed by LocalAgreement are added to locked_words
        new_delta_append: list[str] = []

        # If LocalAgreement confirmed new words, absorb them into _locked_words
        for w in confirmed_words:
            if not self._locked_words or len(self._locked_words) < len(confirmed_words):
                idx = len(self._locked_words)
                if idx < len(confirmed_words):
                    cw = confirmed_words[idx]
                    self._locked_words.append(cw)
                    new_delta_append.append(cw)

        # 2. Analyze tentative words with LCP
        clean_prev = [self._clean(w) for w in self._previous_tentative]
        clean_curr = [self._clean(w) for w in raw_tentative_words]

        # Calculate Common Prefix length
        lcp_len = 0
        min_len = min(len(clean_prev), len(clean_curr))
        for i in range(min_len):
            if clean_prev[i] == clean_curr[i] and clean_curr[i]:
                lcp_len += 1
            else:
                break

        # Update stability for matched words
        new_stability: list[int] = []
        for i in range(len(raw_tentative_words)):
            if i < lcp_len and i < len(self._word_stability):
                new_stability.append(self._word_stability[i] + 1)
            else:
                new_stability.append(1)
        self._word_stability = new_stability

        # 3. Check if early tentative words are stable enough (>= 2 ticks) to lock
        # Only the last `max_mutable_tail_words` can remain mutable
        num_tentative = len(raw_tentative_words)
        words_to_lock = 0
        for i in range(num_tentative - self.max_mutable_tail_words):
            if i < len(self._word_stability) and self._word_stability[i] >= self.stability_ticks_to_lock:
                words_to_lock = i + 1
            else:
                break

        if words_to_lock > 0:
            for w in raw_tentative_words[:words_to_lock]:
                self._locked_words.append(w)
                new_delta_append.append(w)
            # Remove locked portion from tentative
            raw_tentative_words = raw_tentative_words[words_to_lock:]
            self._word_stability = self._word_stability[words_to_lock:]

        # 4. Any newly appeared words beyond the previous tentative length are deltas
        if len(raw_tentative_words) > len(self._previous_tentative):
            for w in raw_tentative_words[len(self._previous_tentative):]:
                if w not in new_delta_append:
                    new_delta_append.append(w)

        # 5. Split remaining tentative into stable vs mutable tail
        if len(raw_tentative_words) > self.max_mutable_tail_words:
            tail_split = len(raw_tentative_words) - self.max_mutable_tail_words
            mutable_tail_words = raw_tentative_words[tail_split:]
        else:
            mutable_tail_words = raw_tentative_words

        self._previous_tentative = list(raw_tentative_words)

        locked_str = " ".join(self._locked_words).strip()
        mutable_str = " ".join(mutable_tail_words).strip()

        if locked_str and mutable_str:
            full_str = f"{locked_str} {mutable_str}"
        else:
            full_str = locked_str or mutable_str

        # Check if last word contains sentence-ending punctuation
        is_end = bool(re.search(r"[.?!。]\s*$", full_str))

        return StreamDiffResult(
            locked_prefix=locked_str,
            delta_append=new_delta_append,
            mutable_tail=mutable_str,
            full_display_text=full_str,
            is_clause_end=is_end,
        )
