"""Word-by-Word Streaming ASR Engine with LocalAgreement-2 & Prefix-Locked Decoding.

- Faster-Whisper with word_timestamps=True, condition_on_previous_text=False, beam_size=1.
- Prefix-Locked Decoding: forces confirmed words directly to CTranslate2 decoder.
- Dynamic Context Prompting: uses last 2 completed sentences + multilingual terminology.
- SmoothStreamDiffer: LCP delta diffing with locked_prefix, delta_append, and mutable_tail.
- Immediate tentative word streaming for < 250ms feedback.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
import numpy as np
from faster_whisper import WhisperModel

from app.realtime_engine.smooth_differ import SmoothStreamDiffer, StreamDiffResult

logger = logging.getLogger(__name__)

DEFAULT_MEETING_HOTWORDS = (
    "họp bàn dự án tiến độ ngân sách kế hoạch triển khai OKR KPI roadmap sprint release bug fix "
    "frontend backend microservices meeting schedule API sync AI Google Gemini Faster-Whisper"
)


@dataclass(frozen=True)
class WordToken:
    text: str
    start: float
    end: float
    probability: float
    is_final: bool = False

    def clean_text(self) -> str:
        return self.text.strip().lower()


@dataclass
class ASRHypothesisResult:
    confirmed_words: list[WordToken] = field(default_factory=list)
    tentative_words: list[WordToken] = field(default_factory=list)
    newly_confirmed: list[WordToken] = field(default_factory=list)
    trim_timestamp_s: float | None = None
    # Phase 3 LCP Delta Diffing fields
    locked_prefix: str = ""
    delta_append: list[str] = field(default_factory=list)
    mutable_tail: str = ""

    @property
    def confirmed_text(self) -> str:
        return " ".join(w.text.strip() for w in self.confirmed_words if w.text.strip())

    @property
    def tentative_text(self) -> str:
        return " ".join(w.text.strip() for w in self.tentative_words if w.text.strip())

    @property
    def full_display_text(self) -> str:
        if self.locked_prefix and self.mutable_tail:
            return f"{self.locked_prefix} {self.mutable_tail}".strip()
        c = self.confirmed_text
        t = self.tentative_text
        if c and t:
            return f"{c} {t}"
        return c or t


class LocalAgreementBuffer:
    """Implements LocalAgreement-2 algorithm for online streaming speech recognition."""

    def __init__(self, time_tolerance_s: float = 0.35, min_words_for_trim: int = 12):
        self.time_tolerance_s = time_tolerance_s
        self.min_words_for_trim = min_words_for_trim
        self.confirmed_words: list[WordToken] = []
        self.last_hypothesis: list[WordToken] = []
        self.last_trim_time: float = 0.0

    def reset(self) -> None:
        self.confirmed_words.clear()
        self.last_hypothesis.clear()
        self.last_trim_time = 0.0

    def update(self, current_words: list[WordToken]) -> ASRHypothesisResult:
        """Run LocalAgreement-2 against the previous tick hypothesis."""
        newly_confirmed: list[WordToken] = []

        # Find prefix agreement between last_hypothesis and current_words
        match_count = 0
        min_len = min(len(self.last_hypothesis), len(current_words))

        for i in range(min_len):
            prev_w = self.last_hypothesis[i]
            curr_w = current_words[i]

            text_match = prev_w.clean_text() == curr_w.clean_text()
            time_match = abs(prev_w.start - curr_w.start) <= self.time_tolerance_s

            if text_match and time_match:
                match_count += 1
            else:
                break

        # Words with agreement 2 that are not yet confirmed are committed
        already_confirmed_count = len(self.confirmed_words)
        for i in range(match_count):
            if i >= already_confirmed_count:
                token = WordToken(
                    text=current_words[i].text,
                    start=current_words[i].start,
                    end=current_words[i].end,
                    probability=current_words[i].probability,
                    is_final=True,
                )
                self.confirmed_words.append(token)
                newly_confirmed.append(token)

        # Everything after confirmed words is tentative (displayed immediately)
        tentative = [
            WordToken(
                text=w.text,
                start=w.start,
                end=w.end,
                probability=w.probability,
                is_final=False,
            )
            for w in current_words[len(self.confirmed_words) :]
        ]

        # Check if we should trim the audio buffer:
        # Trigger when confirmed words exceed 5s of audio or end in sentence-ending punctuation
        trim_time: float | None = None
        if len(self.confirmed_words) > 0:
            last_confirmed = self.confirmed_words[-1]
            confirmed_span = last_confirmed.end - self.last_trim_time
            has_punctuation = bool(re.search(r"[.?!。]\s*$", last_confirmed.text))

            if (confirmed_span >= 5.0 or (has_punctuation and len(self.confirmed_words) >= 6)) and last_confirmed.end > self.last_trim_time:
                trim_time = last_confirmed.end
                self.last_trim_time = trim_time

        # Store current hypothesis for next tick
        self.last_hypothesis = list(current_words)

        return ASRHypothesisResult(
            confirmed_words=list(self.confirmed_words),
            tentative_words=tentative,
            newly_confirmed=newly_confirmed,
            trim_timestamp_s=trim_time,
        )


class WordByWordASR:
    """Optimized Faster-Whisper streaming engine with prefix-locked decoding."""

    def __init__(
        self,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "vi",
        hotwords: str | None = None,
    ):
        self.language = language
        self.hotwords = hotwords or DEFAULT_MEETING_HOTWORDS
        logger.info("Initializing Faster-Whisper model (%s, %s, %s)...", model_size, device, compute_type)
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.hypothesis_buffer = LocalAgreementBuffer()
        self.differ = SmoothStreamDiffer(max_mutable_tail_words=2, stability_ticks_to_lock=2)
        logger.info("Faster-Whisper model ready with Prefix-Locked Decoding.")

    def get_recent_prefix(self, max_words: int = 25) -> str:
        """Extract confirmed words of current sentence to lock into Whisper prefix."""
        confirmed = self.hypothesis_buffer.confirmed_words
        if not confirmed:
            return ""
        slice_words = confirmed[-max_words:]
        return " ".join(w.text.strip() for w in slice_words if w.text.strip())

    def _build_dynamic_prompt(self, recent_sentences: list[str] | None = None) -> str:
        """Build initial_prompt combining recent completed sentences + meeting keywords."""
        if not recent_sentences:
            return self.hotwords
        context = " ".join(s.strip() for s in recent_sentences[-2:] if s.strip())
        if context:
            return f"{context} | {self.hotwords}"
        return self.hotwords

    def process_tick(
        self,
        audio_window: np.ndarray,
        stream_offset_s: float = 0.0,
        history_sentences: list[str] | None = None,
    ) -> ASRHypothesisResult:
        """Run single 250ms inference tick with Prefix-Locked Decoding."""
        if len(audio_window) < 1600:  # < 100ms
            diff_res = self.differ.process(
                [w.text for w in self.hypothesis_buffer.confirmed_words],
                [],
            )
            return ASRHypothesisResult(
                confirmed_words=list(self.hypothesis_buffer.confirmed_words),
                tentative_words=[],
                newly_confirmed=[],
                trim_timestamp_s=None,
                locked_prefix=diff_res.locked_prefix,
                delta_append=[],
                mutable_tail="",
            )

        # Prefix locking: pass confirmed text of the sentence so CTranslate2 does not re-decode it
        prefix = self.get_recent_prefix(max_words=25)
        dynamic_prompt = self._build_dynamic_prompt(history_sentences)

        # Faster-Whisper configuration: greedy decoding, beam_size=1, condition_on_previous_text=False
        segments, _ = self.model.transcribe(
            audio_window,
            language=self.language,
            word_timestamps=True,
            condition_on_previous_text=False,  # CRITICAL: prevents repetition hallucination loops
            beam_size=1,  # Greedy decoding for ultra-fast < 150ms execution
            temperature=(0.0, 0.2),
            initial_prompt=dynamic_prompt,
            prefix=prefix or None,
            vad_filter=False,  # Outer Silero VAD handles voice detection
        )

        words_out: list[WordToken] = []
        for segment in segments:
            if segment.words:
                for w in segment.words:
                    if w.word and w.word.strip():
                        w_start = round(stream_offset_s + float(w.start), 3)
                        w_end = round(stream_offset_s + float(w.end), 3)
                        words_out.append(
                            WordToken(
                                text=w.word,
                                start=w_start,
                                end=w_end,
                                probability=float(getattr(w, "probability", 0.9)),
                            )
                        )

        # 1. Run LocalAgreement-2
        la_result = self.hypothesis_buffer.update(words_out)

        # 2. Run LCP Delta Diffing to get locked_prefix, delta_append, mutable_tail
        confirmed_texts = [w.text.strip() for w in la_result.confirmed_words if w.text.strip()]
        tentative_texts = [w.text.strip() for w in la_result.tentative_words if w.text.strip()]
        diff_res = self.differ.process(confirmed_texts, tentative_texts)

        la_result.locked_prefix = diff_res.locked_prefix
        la_result.delta_append = diff_res.delta_append
        la_result.mutable_tail = diff_res.mutable_tail
        return la_result

    def reset(self) -> None:
        self.hypothesis_buffer.reset()
        self.differ.reset()
