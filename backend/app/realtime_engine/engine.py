"""Realtime Meeting Engine Coordinator with ChatGPT-Style Smooth Streaming.

Coordinates:
1. AudioStreamBuffer (16kHz PCM, Bandpass 80-8000Hz, AGC Loudness, Silero VAD)
2. WordByWordASR (Faster-Whisper, Prefix-Locked Decoding, 250ms cadence, LCP Delta Diffing)
3. OnlineSpeakerTracker (CAM++ 512-dim Embeddings, Cosine Centroids, Hysteresis Lock)
4. StreamingTranslator (SSE Token Streaming, Speculative Live Translation)
5. TokenPacerQueue (ChatGPT-Style Typewriter Pacer with Adaptive Drain)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncGenerator, Callable, Coroutine
import numpy as np

from app.realtime_engine.audio_buffer import AudioStreamBuffer
from app.realtime_engine.speaker_tracker import OnlineSpeakerTracker, SpeakerTurn
from app.realtime_engine.streaming_translator import StreamingTranslator
from app.realtime_engine.token_pacer import TokenPacerQueue
from app.realtime_engine.word_asr import WordByWordASR, WordToken

logger = logging.getLogger(__name__)


@dataclass
class RealtimeEngineEvent:
    speaker: str
    confirmed_text: str
    tentative_text: str
    live_translation: str
    latency_ms: int
    is_final: bool
    confirmed_words: list[WordToken] = field(default_factory=list)
    tentative_words: list[WordToken] = field(default_factory=list)
    turn_id: str = ""
    # Phase 3 Smooth Streaming fields
    locked_prefix: str = ""
    delta_tokens: list[str] = field(default_factory=list)
    mutable_tail: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "speaker": self.speaker,
            "confirmed_text": self.confirmed_text,
            "tentative_text": self.tentative_text,
            "live_translation": self.live_translation,
            "latency_ms": self.latency_ms,
            "is_final": self.is_final,
            "turn_id": self.turn_id,
            "locked_prefix": self.locked_prefix,
            "delta_tokens": self.delta_tokens,
            "mutable_tail": self.mutable_tail,
        }


class RealtimeMeetingEngine:
    """End-to-End Realtime Streaming Engine with 250ms Prefix-Locked Decoding."""

    def __init__(
        self,
        whisper_model_size: str = "base",
        whisper_device: str = "cpu",
        whisper_compute_type: str = "int8",
        language: str = "vi",
        gemini_api_key: str | None = None,
        groq_api_key: str | None = None,
        tick_interval_s: float = 0.25,  # 250ms tick cadence
        on_event_callback: Callable[[RealtimeEngineEvent], Coroutine[None, None, None]] | None = None,
    ):
        self.tick_interval_s = tick_interval_s
        self.on_event_callback = on_event_callback

        self.audio_buffer = AudioStreamBuffer(max_duration_s=30.0)
        self.asr = WordByWordASR(
            model_size=whisper_model_size,
            device=whisper_device,
            compute_type=whisper_compute_type,
            language=language,
        )
        self.speaker_tracker = OnlineSpeakerTracker()
        self.translator = StreamingTranslator(
            gemini_api_key=gemini_api_key,
            groq_api_key=groq_api_key,
            on_translation_callback=self._on_translation_update,
        )
        self.token_pacer = TokenPacerQueue()

        self._running = False
        self._loop_task: asyncio.Task | None = None
        self._turn_counter = 1
        self._current_speaker = "SPEAKER_01"
        self._confirmed_history: list[str] = []
        self._live_translation_cache: str = ""
        self._last_speech_time = time.time()
        self._clause_finalized = False

    async def _on_translation_update(self, task_id: str, text: str, is_final: bool) -> None:
        self._live_translation_cache = text

    async def start(self) -> None:
        """Start the realtime processing engine."""
        if self._running:
            return
        self._running = True
        self.token_pacer.start()
        await self.translator.start()
        self._loop_task = asyncio.create_task(self._inference_loop(), name="realtime-engine-loop")
        logger.info("RealtimeMeetingEngine started with 250ms prefix-locked cadence.")

    async def stop(self) -> None:
        """Stop the realtime processing engine."""
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()
            self._loop_task = None
        await self.token_pacer.stop()
        await self.translator.stop()
        logger.info("RealtimeMeetingEngine stopped.")

    def push_audio(self, pcm16_bytes: bytes | memoryview) -> None:
        """Push incoming microphone / network audio chunks into the ring buffer."""
        self.audio_buffer.append_pcm16_bytes(pcm16_bytes)

    async def _inference_loop(self) -> None:
        """250ms rolling inference loop."""
        while self._running:
            start_tick = time.monotonic()
            try:
                # 1. Silero VAD check on latest 300ms audio slice
                has_speech = self.audio_buffer.has_speech_in_tail(tail_ms=300, threshold=0.35)

                if has_speech:
                    now = time.time()
                    speech_pause_ms = (now - self._last_speech_time) * 1000.0 if not self._clause_finalized else 500.0
                    self._last_speech_time = now
                    await self._process_speech_tick(start_tick, speech_pause_ms)
                else:
                    # Silence check: if previously speaking and now silent > 1.2s, finalize clause
                    silent_duration = time.time() - self._last_speech_time
                    if silent_duration > 1.2 and not self._clause_finalized:
                        await self._finalize_active_clause(start_tick)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Error in realtime inference tick: %s", exc, exc_info=True)

            elapsed = time.monotonic() - start_tick
            sleep_time = max(0.01, self.tick_interval_s - elapsed)
            await asyncio.sleep(sleep_time)

    async def _process_speech_tick(self, tick_start_time: float, speech_pause_ms: float = 0.0) -> None:
        """Execute prefix-locked ASR, hysteresis speaker assignment, and speculative translation."""
        self._clause_finalized = False

        # Extract sliding audio window (up to 10s)
        audio_window = self.audio_buffer.get_sliding_window(max_seconds=10.0)
        stream_time = self.audio_buffer.current_stream_time_s
        buffer_start_time = max(0.0, stream_time - (len(audio_window) / 16000.0))

        # 2. Faster-Whisper Word-by-Word ASR with Prefix-Locked Decoding & LCP Diffing
        asr_result = self.asr.process_tick(
            audio_window,
            stream_offset_s=buffer_start_time,
            history_sentences=self._confirmed_history,
        )

        # 3. Online Speaker Identification with Hysteresis Lock on recent 1.5s speech
        diar_audio = self.audio_buffer.get_diarization_window(seconds=1.5)
        if len(diar_audio) >= 8000:
            assigned_speaker = self.speaker_tracker.identify_speaker(
                diar_audio,
                pause_gap_ms=speech_pause_ms,
            )
            self._current_speaker = assigned_speaker

        # 4. Enqueue Speculative Live Translation if tentative words are active
        active_tentative = asr_result.tentative_text or asr_result.mutable_tail
        if active_tentative:
            self.translator.enqueue_preview(self._current_speaker, active_tentative)

        # 5. Handle buffer trimming if LocalAgreement-2 finalized a 5s block
        if asr_result.trim_timestamp_s is not None:
            self.audio_buffer.trim_before_time(asr_result.trim_timestamp_s)

        # 6. Push new delta tokens to typewriter pacer queue
        if asr_result.delta_append:
            self.token_pacer.push_tokens(asr_result.delta_append)

        # 7. Calculate total latency
        latency_ms = int((time.monotonic() - tick_start_time) * 1000)

        # 8. Construct and emit event payload
        event = RealtimeEngineEvent(
            speaker=self._current_speaker,
            confirmed_text=asr_result.confirmed_text,
            tentative_text=asr_result.tentative_text,
            live_translation=self._live_translation_cache,
            latency_ms=latency_ms,
            is_final=False,
            confirmed_words=asr_result.confirmed_words,
            tentative_words=asr_result.tentative_words,
            turn_id=f"turn_{self._turn_counter}",
            locked_prefix=asr_result.locked_prefix,
            delta_tokens=asr_result.delta_append,
            mutable_tail=asr_result.mutable_tail,
        )

        if self.on_event_callback:
            await self.on_event_callback(event)

    async def _finalize_active_clause(self, tick_start_time: float) -> None:
        """Lock clause when speech pauses, submit Mode 2 Contextual Translation, and increment turn."""
        self._clause_finalized = True
        confirmed = self.asr.hypothesis_buffer.confirmed_words
        if not confirmed:
            return

        full_sentence = " ".join(w.text.strip() for w in confirmed if w.text.strip())
        if not full_sentence:
            return

        # Flush token pacer
        self.token_pacer.flush_all()

        # Enqueue Mode 2 Contextual Translation with 5 previous sentences
        turn_id = f"turn_{self._turn_counter}"
        self.translator.enqueue_final(
            task_id=turn_id,
            speaker=self._current_speaker,
            text=full_sentence,
            context=self._confirmed_history,
        )

        self._confirmed_history.append(f"({self._current_speaker}): {full_sentence}")

        latency_ms = int((time.monotonic() - tick_start_time) * 1000)
        event = RealtimeEngineEvent(
            speaker=self._current_speaker,
            confirmed_text=full_sentence,
            tentative_text="",
            live_translation=self._live_translation_cache,
            latency_ms=latency_ms,
            is_final=True,
            confirmed_words=list(confirmed),
            tentative_words=[],
            turn_id=turn_id,
            locked_prefix=full_sentence,
            delta_tokens=[],
            mutable_tail="",
        )

        if self.on_event_callback:
            await self.on_event_callback(event)

        # Advance turn & reset hypothesis buffer and speaker hysteresis for next clause
        self._turn_counter += 1
        self.asr.reset()
        self.token_pacer.reset()
        self.speaker_tracker.reset_active_speaker()
        self.audio_buffer.trim_before_time(self.audio_buffer.current_stream_time_s)
        self._live_translation_cache = ""
