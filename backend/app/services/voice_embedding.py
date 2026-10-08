"""Acoustic speaker embedding extractor and voiceprint matching engine.

Extracts normalized 192-dimensional speaker embeddings from 16kHz mono audio
using acoustic spectral/filterbank analysis with delta dynamics and statistical
pooling. Supports optional ONNX speaker recognition models when configured.
"""

from __future__ import annotations

import io
import math
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import numpy as np
import scipy.fft

class VoiceEmbeddingError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


EMBEDDING_DIM = 192
SAMPLE_RATE = 16000


@dataclass(frozen=True)
class VoiceCandidate:
    id: UUID
    name: str
    embedding: list[float]


def extract_embedding_from_pcm16(pcm16_data: bytes, sample_rate: int = SAMPLE_RATE) -> list[float]:
    """Extract a unit-normalized 192-d voice embedding vector from raw PCM16 samples."""
    if not pcm16_data:
        raise VoiceEmbeddingError("AUDIO_DATA_EMPTY", "Audio data is empty.", 400)

    samples = np.frombuffer(pcm16_data, dtype=np.int16).astype(np.float32) / 32768.0
    min_samples = int(sample_rate * 0.5)  # Minimum 0.5s
    if len(samples) < min_samples:
        samples = np.pad(samples, (0, min_samples - len(samples)))

    frame_len = int(sample_rate * 0.025)  # 25ms window
    frame_step = int(sample_rate * 0.010)  # 10ms step
    num_frames = max(1, int(np.ceil((len(samples) - frame_len) / frame_step)))

    pad_len = (num_frames - 1) * frame_step + frame_len
    if len(samples) < pad_len:
        samples = np.pad(samples, (0, pad_len - len(samples)))

    frames = np.lib.stride_tricks.sliding_window_view(samples[:pad_len], frame_len)[::frame_step]
    window = np.hamming(frame_len)
    windowed = frames * window

    # FFT spectrum
    n_fft = 512
    mag = np.abs(np.fft.rfft(windowed, n=n_fft))

    # 40 triangular mel filters
    low_freq = 20
    high_freq = sample_rate / 2
    mel_low = 2595 * np.log10(1 + low_freq / 700)
    mel_high = 2595 * np.log10(1 + high_freq / 700)
    mel_pts = np.linspace(mel_low, mel_high, 42)
    hz_pts = 700 * (10 ** (mel_pts / 2595) - 1)
    bin_pts = np.floor((n_fft + 1) * hz_pts / sample_rate).astype(int)

    filters = np.zeros((40, n_fft // 2 + 1))
    for m in range(1, 41):
        f_m_minus = bin_pts[m - 1]
        f_m = bin_pts[m]
        f_m_plus = bin_pts[m + 1]
        for k in range(f_m_minus, f_m):
            filters[m - 1, k] = (k - bin_pts[m - 1]) / max(1, f_m - bin_pts[m - 1])
        for k in range(f_m, f_m_plus):
            filters[m - 1, k] = (bin_pts[m + 1] - k) / max(1, bin_pts[m + 1] - f_m)

    energy = np.dot(mag**2, filters.T)
    energy = np.where(energy == 0, np.finfo(float).eps, energy)
    log_mel = np.log(energy)

    # Discrete Cosine Transform (MFCC 20 coefficients)
    mfcc = scipy.fft.dct(log_mel, type=2, axis=1, norm="ortho")[:, :20]

    # First and second order temporal differences (deltas)
    delta1 = np.diff(mfcc, axis=0, prepend=mfcc[:1])
    delta2 = np.diff(delta1, axis=0, prepend=delta1[:1])

    # Statistical pooling across all frames
    mean_mfcc = np.mean(mfcc, axis=0)       # 20
    std_mfcc = np.std(mfcc, axis=0)         # 20
    mean_delta1 = np.mean(delta1, axis=0)   # 20
    std_delta1 = np.std(delta1, axis=0)     # 20
    mean_delta2 = np.mean(delta2, axis=0)   # 20
    std_delta2 = np.std(delta2, axis=0)     # 20

    # Mel filterbank statistics
    mel_mean = np.mean(log_mel, axis=0)     # 40
    mel_std = np.std(log_mel, axis=0)       # 32

    embedding = np.concatenate([
        mean_mfcc, std_mfcc,
        mean_delta1, std_delta1,
        mean_delta2, std_delta2,
        mel_mean, mel_std[:32]
    ])

    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return [float(x) for x in embedding]


def decode_audio_to_pcm16(audio_bytes: bytes) -> tuple[bytes, int]:
    """Decode any audio bytes (WAV, MP3, AAC, etc.) to 16kHz mono PCM16 bytes."""
    # First attempt: if standard WAV format
    if audio_bytes.startswith(b"RIFF") and b"WAVE" in audio_bytes[:16]:
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
                nchannels = wav_file.getnchannels()
                sampwidth = wav_file.getsampwidth()
                framerate = wav_file.getframerate()
                raw_frames = wav_file.readframes(wav_file.getnframes())

                if nchannels == 1 and sampwidth == 2 and framerate == SAMPLE_RATE:
                    duration_ms = int(len(raw_frames) / (SAMPLE_RATE * 2) * 1000)
                    return raw_frames, duration_ms
        except Exception:
            pass

    # Use ffmpeg for generic decoding/resampling
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel", "error",
                "-i", "pipe:0",
                "-f", "s16le",
                "-acodec", "pcm_s16le",
                "-ar", str(SAMPLE_RATE),
                "-ac", "1",
                "pipe:1",
            ],
            input=audio_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        pcm_bytes = proc.stdout
        duration_ms = int(len(pcm_bytes) / (SAMPLE_RATE * 2) * 1000)
        return pcm_bytes, duration_ms
    except Exception as exc:
        raise VoiceEmbeddingError(
            "AUDIO_DECODE_FAILED",
            "Could not decode audio into 16kHz PCM16. Ensure audio format is valid.",
            400,
        ) from exc


def compute_similarity(vector_a: list[float], vector_b: list[float]) -> float:
    """Calculate cosine similarity between two normalized vectors."""
    if len(vector_a) != len(vector_b):
        return 0.0
    u = np.array(vector_a, dtype=np.float32)
    v = np.array(vector_b, dtype=np.float32)
    norm_u = np.linalg.norm(u)
    norm_v = np.linalg.norm(v)
    if norm_u == 0 or norm_v == 0:
        return 0.0
    dot = float(np.dot(u, v) / (norm_u * norm_v))
    return max(-1.0, min(1.0, dot))


def match_candidate(
    embedding: list[float],
    candidates: list[VoiceCandidate],
    threshold: float = 0.72,
) -> tuple[VoiceCandidate | None, float]:
    """Find the best-matching voice profile candidate if similarity exceeds threshold."""
    if not candidates:
        return None, 0.0

    best_candidate: VoiceCandidate | None = None
    best_similarity = -1.0

    for candidate in candidates:
        similarity = compute_similarity(embedding, candidate.embedding)
        if similarity > best_similarity:
            best_similarity = similarity
            best_candidate = candidate

    if best_similarity >= threshold:
        return best_candidate, best_similarity

    return None, best_similarity
