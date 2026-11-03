"""Real-Time Audio Ring Buffer & Preprocessing for Meeting Streaming.

- Normalization to PCM 16kHz, Mono, 16-bit Float32 [-1.0, 1.0].
- Dynamic Loudness Normalization (Sliding RMS Automatic Gain Control).
- Voice Bandpass Filtering (80Hz - 8000Hz) in pure NumPy.
- Rolling Audio Ring Buffer with trimming capabilities.
- Silero VAD (ONNX runtime) for low-overhead voice activity detection.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Final
import numpy as np
import onnxruntime

logger = logging.getLogger(__name__)

SAMPLE_RATE: Final[int] = 16000
VAD_CHUNK_SIZE: Final[int] = 512  # 32ms at 16kHz


def create_biquad_bandpass(
    low_cutoff_hz: float = 80.0,
    high_cutoff_hz: float = 8000.0,
    sample_rate: float = 16000.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Calculate 2nd order Butterworth bandpass coefficients using bilinear transform."""
    w_low = 2.0 * sample_rate * np.tan(np.pi * low_cutoff_hz / sample_rate)
    w_high = 2.0 * sample_rate * np.tan(np.pi * high_cutoff_hz / sample_rate)
    w0 = np.sqrt(w_low * w_high)
    bw = w_high - w_low

    q = w0 / bw
    omega = 2.0 * np.pi * w0 / sample_rate
    alpha = np.sin(omega) / (2.0 * q)

    b0 = alpha
    b1 = 0.0
    b2 = -alpha
    a0 = 1.0 + alpha
    a1 = -2.0 * np.cos(omega)
    a2 = 1.0 - alpha

    b = np.array([b0 / a0, b1 / a0, b2 / a0], dtype=np.float32)
    a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float32)
    return b, a


class DigitalBandpassFilter:
    """Zero-dependency IIR 80Hz - 8000Hz filter using pure NumPy."""

    def __init__(self, low_hz: float = 80.0, high_hz: float = 7900.0, sr: float = 16000.0):
        self.b, self.a = create_biquad_bandpass(low_hz, high_hz, sr)
        self.x1 = 0.0
        self.x2 = 0.0
        self.y1 = 0.0
        self.y2 = 0.0

    def process(self, x: np.ndarray) -> np.ndarray:
        """Process chunk with continuous state retention."""
        y = np.empty_like(x, dtype=np.float32)
        b0, b1, b2 = self.b
        a1, a2 = self.a[1], self.a[2]

        x1, x2 = self.x1, self.x2
        y1, y2 = self.y1, self.y2

        for i in range(len(x)):
            xi = float(x[i])
            yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            y[i] = yi
            x2 = x1
            x1 = xi
            y2 = y1
            y1 = yi

        self.x1, self.x2 = x1, x2
        self.y1, self.y2 = y1, y2
        return y


class DynamicLoudnessNormalizer:
    """Sliding-window Automatic Gain Control (AGC) targeting -20 dBFS.

    Smoothly amplifies far-mic quiet speech without digital clipping.
    """

    def __init__(self, target_rms: float = 0.10, max_gain: float = 4.0, smoothing: float = 0.95):
        self.target_rms = target_rms
        self.max_gain = max_gain
        self.smoothing = smoothing
        self.current_gain = 1.5

    def process(self, audio: np.ndarray) -> np.ndarray:
        if len(audio) == 0:
            return audio
        rms = float(np.sqrt(np.mean(audio**2)))
        if rms > 1e-4:
            instant_gain = min(self.max_gain, max(0.5, self.target_rms / (rms + 1e-6)))
            self.current_gain = self.smoothing * self.current_gain + (1.0 - self.smoothing) * instant_gain

        normalized = audio * self.current_gain
        # Soft-clip limiter to guarantee range [-1.0, 1.0]
        return np.tanh(normalized)


class SileroVAD:
    """Fast ONNX Silero VAD runner for voice presence checking."""

    def __init__(self, model_path: Path | str | None = None):
        if model_path is None:
            model_path = Path(__file__).parent / "models" / "silero_vad.onnx"
        self.model_path = Path(model_path)
        self.session: onnxruntime.InferenceSession | None = None
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.sr = np.array(SAMPLE_RATE, dtype=np.int64)
        self._init_session()

    def _init_session(self) -> None:
        if not self.model_path.exists():
            try:
                self.model_path.parent.mkdir(parents=True, exist_ok=True)
                import httpx
                r = httpx.get(
                    "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx",
                    follow_redirects=True,
                    timeout=30.0,
                    verify=False,
                )
                if r.status_code == 200:
                    with open(self.model_path, "wb") as f:
                        f.write(r.content)
            except Exception as dl_err:
                logger.warning("Could not auto-download Silero VAD model: %s", dl_err)

        if self.model_path.exists():
            opts = onnxruntime.SessionOptions()
            opts.inter_op_num_threads = 1
            opts.intra_op_num_threads = 1
            self.session = onnxruntime.InferenceSession(str(self.model_path), sess_options=opts)
            logger.info("Silero VAD ONNX model initialized from %s", self.model_path)
        else:
            logger.warning("Silero VAD model not found at %s. Using energy-based fallback.", self.model_path)

    def is_speech(self, chunk: np.ndarray, threshold: float = 0.40) -> bool:
        """Evaluate if 512-sample chunk contains active speech."""
        if self.session is None or len(chunk) != VAD_CHUNK_SIZE:
            # Fallback energy test
            energy = float(np.mean(chunk**2))
            return energy > 0.0008

        inputs = {
            "input": chunk.reshape(1, -1).astype(np.float32),
            "state": self.state,
            "sr": self.sr,
        }
        try:
            out, next_state = self.session.run(None, inputs)
            self.state = next_state
            prob = float(out[0][0])
            return prob >= threshold
        except Exception:
            return float(np.mean(chunk**2)) > 0.0008


class AudioStreamBuffer:
    """Rolling Ring Buffer with 350ms tick cadence and buffer trimming."""

    def __init__(
        self,
        max_duration_s: float = 30.0,
        target_sr: int = 16000,
        vad_model_path: Path | str | None = None,
    ):
        self.target_sr = target_sr
        self.max_samples = int(max_duration_s * target_sr)
        self.filter = DigitalBandpassFilter(low_hz=80.0, high_hz=7800.0, sr=target_sr)
        self.agc = DynamicLoudnessNormalizer()
        self.vad = SileroVAD(vad_model_path)

        self._buffer = np.zeros(self.max_samples, dtype=np.float32)
        self._write_pos = 0
        self._total_samples_written = 0
        self._trimmed_samples = 0

    def append_pcm16_bytes(self, pcm_data: bytes | memoryview) -> int:
        """Convert PCM 16-bit LE bytes to normalized float32 and append to buffer."""
        if not pcm_data:
            return 0
        raw_samples = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
        # Preprocess: Bandpass + Dynamic Loudness
        filtered = self.filter.process(raw_samples)
        normalized = self.agc.process(filtered)

        n = len(normalized)
        if n == 0:
            return 0

        if n >= self.max_samples:
            # Chunk larger than buffer, keep latest part
            self._buffer[:] = normalized[-self.max_samples :]
            self._write_pos = self.max_samples
        else:
            space_left = self.max_samples - self._write_pos
            if n <= space_left:
                self._buffer[self._write_pos : self._write_pos + n] = normalized
                self._write_pos += n
            else:
                # Shift buffer left to make room
                shift = n - space_left
                self._buffer[:-n] = self._buffer[shift : self._write_pos]
                self._buffer[-n:] = normalized
                self._write_pos = self.max_samples

        self._total_samples_written += n
        return n

    def has_speech_in_tail(self, tail_ms: int = 350, threshold: float = 0.35) -> bool:
        """Check if voice is present in the latest audio slice using Silero VAD."""
        tail_samples = int((tail_ms / 1000.0) * self.target_sr)
        avail = min(self._write_pos, tail_samples)
        if avail < VAD_CHUNK_SIZE:
            return False

        slice_data = self._buffer[self._write_pos - avail : self._write_pos]
        # Check in 512-sample chunks
        num_chunks = len(slice_data) // VAD_CHUNK_SIZE
        speech_chunks = 0
        for i in range(num_chunks):
            chunk = slice_data[i * VAD_CHUNK_SIZE : (i + 1) * VAD_CHUNK_SIZE]
            if self.vad.is_speech(chunk, threshold=threshold):
                speech_chunks += 1
                if speech_chunks >= 1:
                    return True
        return False

    def get_sliding_window(self, max_seconds: float = 10.0) -> np.ndarray:
        """Retrieve the active un-trimmed sliding audio window for Whisper ASR."""
        active_samples = min(self._write_pos, int(max_seconds * self.target_sr))
        if active_samples <= 0:
            return np.zeros(0, dtype=np.float32)
        return self._buffer[self._write_pos - active_samples : self._write_pos].copy()

    def get_diarization_window(self, seconds: float = 1.5) -> np.ndarray:
        """Retrieve recent 1.5s - 2.0s audio for speaker embedding extraction."""
        needed = int(seconds * self.target_sr)
        avail = min(self._write_pos, needed)
        if avail <= 0:
            return np.zeros(0, dtype=np.float32)
        return self._buffer[self._write_pos - avail : self._write_pos].copy()

    def trim_before_time(self, timestamp_s: float) -> None:
        """Trim confirmed audio older than timestamp_s from buffer start."""
        total_stream_time_s = self._total_samples_written / self.target_sr
        current_buffer_duration_s = self._write_pos / self.target_sr
        buffer_start_stream_time_s = max(0.0, total_stream_time_s - current_buffer_duration_s)

        if timestamp_s <= buffer_start_stream_time_s:
            return

        trim_offset_s = timestamp_s - buffer_start_stream_time_s
        trim_samples = int(trim_offset_s * self.target_sr)

        # Retain at least 0.5s margin to prevent word-boundary clipping
        keep_margin_samples = int(0.5 * self.target_sr)
        max_trimmable = max(0, self._write_pos - keep_margin_samples)
        samples_to_cut = min(trim_samples, max_trimmable)

        if samples_to_cut > 0:
            remaining = self._write_pos - samples_to_cut
            self._buffer[:remaining] = self._buffer[samples_to_cut : self._write_pos]
            self._buffer[remaining:] = 0.0
            self._write_pos = remaining
            self._trimmed_samples += samples_to_cut

    @property
    def current_stream_time_s(self) -> float:
        return self._total_samples_written / self.target_sr
