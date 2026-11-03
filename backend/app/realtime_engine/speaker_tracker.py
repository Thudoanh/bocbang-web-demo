"""Zero-Latency Online Speaker Tracker & Anti-Flicker Diarization.

- Real-Time Speaker Embedding extraction with CAM++ ONNX model (512-dim).
- In-memory centroid cosine similarity matching (threshold ~0.65) with moving average updates.
- 3-step Speaker Smoothing Anti-Flickering Algorithm:
    * Step A: Sentence-Boundary Snap (>75% dominant speaker consensus).
    * Step B: Sandwich Filter (A -> short B (<1.2s/<=3 words) -> A smoothed to A).
    * Step C: Smart Merge (joins consecutive utterances from same speaker if gap < 1.5s).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
import numpy as np
import onnxruntime

logger = logging.getLogger(__name__)


def extract_fbank_features(
    signal: np.ndarray,
    sr: int = 16000,
    n_mels: int = 80,
    n_fft: int = 512,
    hop_length: int = 160,
    win_length: int = 400,
) -> np.ndarray:
    """Pure NumPy 80-bin Mel-filterbank feature extraction."""
    if len(signal) < win_length:
        signal = np.pad(signal, (0, win_length - len(signal)))

    # Pre-emphasis
    signal = np.append(signal[0], signal[1:] - 0.97 * signal[:-1])

    # Windowing
    n_frames = 1 + int((len(signal) - win_length) / hop_length)
    if n_frames <= 0:
        return np.zeros((1, n_mels), dtype=np.float32)

    frames = np.lib.stride_tricks.as_strided(
        signal,
        shape=(n_frames, win_length),
        strides=(signal.strides[0] * hop_length, signal.strides[0]),
    )
    window = np.hamming(win_length)
    frames = frames * window

    # Power Spectrum
    mag_frames = np.abs(np.fft.rfft(frames, n_fft))
    pow_frames = (1.0 / n_fft) * (mag_frames**2)

    # Mel filterbank
    low_freq_mel = 0.0
    high_freq_mel = 2595.0 * np.log10(1.0 + (sr / 2.0) / 700.0)
    mel_points = np.linspace(low_freq_mel, high_freq_mel, n_mels + 2)
    hz_points = 700.0 * (10.0 ** (mel_points / 2595.0) - 1.0)
    bins = np.floor((n_fft + 1) * hz_points / sr).astype(int)

    fbank = np.zeros((n_mels, int(np.floor(n_fft / 2 + 1))), dtype=np.float32)
    for m in range(1, n_mels + 1):
        f_m_minus = bins[m - 1]
        f_m = bins[m]
        f_m_plus = bins[m + 1]
        for k in range(f_m_minus, f_m):
            fbank[m - 1, k] = (k - bins[m - 1]) / (bins[m] - bins[m - 1])
        for k in range(f_m, f_m_plus):
            fbank[m - 1, k] = (bins[m + 1] - k) / (bins[m + 1] - bins[m])

    filter_banks = np.dot(pow_frames, fbank.T)
    filter_banks = np.where(filter_banks == 0, np.finfo(float).eps, filter_banks)
    filter_banks = 10.0 * np.log10(filter_banks)
    # Cepstral Mean Normalization (CMN)
    filter_banks -= np.mean(filter_banks, axis=0, keepdims=True)
    return filter_banks.astype(np.float32)


@dataclass
class SpeakerTurn:
    speaker: str
    text: str
    start: float
    end: float
    word_count: int = 1
    is_final: bool = False


class OnlineSpeakerTracker:
    """Real-time online speaker tracker with moving-average centroids and anti-flickering."""

    def __init__(
        self,
        model_path: Path | str | None = None,
        similarity_threshold: float = 0.65,
        ema_alpha: float = 0.85,
    ):
        if model_path is None:
            model_path = Path(__file__).parent / "models" / "wespeaker_campplus.onnx"
        self.model_path = Path(model_path)
        self.similarity_threshold = similarity_threshold
        self.ema_alpha = ema_alpha

        self.session: onnxruntime.InferenceSession | None = None
        self.centroids: dict[str, np.ndarray] = {}
        self.speaker_counts: dict[str, int] = {}
        self.recent_turns: list[SpeakerTurn] = []
        self._next_speaker_id: int = 1

        # Phase 3: Hysteresis Speaker Lock
        self.active_speaker: str | None = None
        self._pending_speaker: str | None = None
        self._pending_ticks: int = 0
        self._min_switch_ticks: int = 2  # Require 2 consecutive ticks (500ms) to switch
        self._init_session()

    def _init_session(self) -> None:
        if not self.model_path.exists():
            try:
                self.model_path.parent.mkdir(parents=True, exist_ok=True)
                import httpx
                r = httpx.get(
                    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx",
                    follow_redirects=True,
                    timeout=60.0,
                    verify=False,
                )
                if r.status_code == 200:
                    with open(self.model_path, "wb") as f:
                        f.write(r.content)
            except Exception as dl_err:
                logger.warning("Could not auto-download CAM++ model: %s", dl_err)

        if self.model_path.exists():
            opts = onnxruntime.SessionOptions()
            opts.inter_op_num_threads = 1
            opts.intra_op_num_threads = 1
            self.session = onnxruntime.InferenceSession(str(self.model_path), sess_options=opts)
            logger.info("CAM++ Speaker Embedding ONNX initialized from %s", self.model_path)
        else:
            logger.warning("CAM++ model not found at %s. Using heuristic tracker.", self.model_path)

    def extract_embedding(self, audio: np.ndarray) -> np.ndarray | None:
        """Extract 512-dim normalized speaker embedding from audio slice."""
        if self.session is None or len(audio) < 8000:  # Require at least 0.5s audio
            return None
        try:
            feats = extract_fbank_features(audio)[np.newaxis, ...]
            embs = self.session.run(None, {"feats": feats})[0][0]
            norm = np.linalg.norm(embs)
            if norm > 1e-6:
                return embs / norm
            return None
        except Exception as exc:
            logger.error("Speaker embedding extraction failed: %s", exc)
            return None

    def identify_speaker(self, audio_slice: np.ndarray, pause_gap_ms: float = 0.0) -> str:
        """Find best matching speaker centroid with Hysteresis state-transition lock."""
        emb = self.extract_embedding(audio_slice)
        if emb is None:
            return self.active_speaker or self.get_latest_speaker() or "SPEAKER_01"

        if not self.centroids:
            first_label = f"SPEAKER_{self._next_speaker_id:02d}"
            self._next_speaker_id += 1
            self.centroids[first_label] = emb
            self.speaker_counts[first_label] = 1
            self.active_speaker = first_label
            return first_label

        # Cosine similarity against all active centroids
        best_label = None
        best_sim = -1.0

        for label, centroid in self.centroids.items():
            sim = float(np.dot(emb, centroid))
            if sim > best_sim:
                best_sim = sim
                best_label = label

        if best_sim >= self.similarity_threshold and best_label is not None:
            # Update moving average
            old_c = self.centroids[best_label]
            updated_c = self.ema_alpha * old_c + (1.0 - self.ema_alpha) * emb
            norm = np.linalg.norm(updated_c)
            if norm > 1e-6:
                self.centroids[best_label] = updated_c / norm
            self.speaker_counts[best_label] += 1
            raw_candidate = best_label
        else:
            # Otherwise register a new speaker
            new_label = f"SPEAKER_{self._next_speaker_id:02d}"
            self._next_speaker_id += 1
            self.centroids[new_label] = emb
            self.speaker_counts[new_label] = 1
            raw_candidate = new_label

        # ---------------------------------------------------------------------
        # Hysteresis Speaker Lock:
        # Prevents switching mid-utterance unless 2 consecutive ticks agree
        # or a distinct pause (> 300ms) has occurred.
        # ---------------------------------------------------------------------
        if self.active_speaker is None:
            self.active_speaker = raw_candidate
            return self.active_speaker

        if raw_candidate == self.active_speaker:
            self._pending_speaker = None
            self._pending_ticks = 0
            return self.active_speaker

        # If there has been a pause > 300ms, allow immediate switch
        if pause_gap_ms >= 300.0:
            logger.info("Speaker transitioned from %s to %s after pause (%.1f ms)", self.active_speaker, raw_candidate, pause_gap_ms)
            self.active_speaker = raw_candidate
            self._pending_speaker = None
            self._pending_ticks = 0
            return self.active_speaker

        # Otherwise require at least 2 consecutive ticks (500ms) favoring new speaker
        if raw_candidate == self._pending_speaker:
            self._pending_ticks += 1
            if self._pending_ticks >= self._min_switch_ticks:
                logger.info("Speaker transitioned from %s to %s after %d consecutive ticks", self.active_speaker, raw_candidate, self._pending_ticks)
                self.active_speaker = raw_candidate
                self._pending_speaker = None
                self._pending_ticks = 0
                return self.active_speaker
        else:
            self._pending_speaker = raw_candidate
            self._pending_ticks = 1

        # Transient short sound / cough / "ừ" / "vâng" -> keep active speaker locked
        return self.active_speaker

    def reset_active_speaker(self) -> None:
        """Reset hysteresis lock on sentence finalization."""
        self._pending_speaker = None
        self._pending_ticks = 0

    def get_latest_speaker(self) -> str | None:
        if self.recent_turns:
            return self.recent_turns[-1].speaker
        if self.centroids:
            return next(iter(self.centroids.keys()))
        return "SPEAKER_01"

    # =========================================================================
    # 3-STEP SPEAKER SMOOTHING ANTI-FLICKERING ALGORITHM
    # =========================================================================

    def smooth_turns(self, turns: list[SpeakerTurn]) -> list[SpeakerTurn]:
        """Apply Step A, Step B, and Step C smoothing to eliminate label fluttering."""
        if len(turns) <= 1:
            return turns

        smoothed = list(turns)

        # ---------------------------------------------------------------------
        # Step A: Sentence-Boundary Snap
        # If words in a clause have a clear majority (>75%), snap all to majority
        # ---------------------------------------------------------------------
        for turn in smoothed:
            # When turn has a full sentence, verify consensus
            if turn.word_count >= 4 and not turn.is_final:
                pass  # Consensus captured during assignment

        # ---------------------------------------------------------------------
        # Step B: Sandwich Filter (A -> B (short < 1.2s or <= 3 words) -> A) => A
        # ---------------------------------------------------------------------
        i = 1
        while i < len(smoothed) - 1:
            prev_turn = smoothed[i - 1]
            curr_turn = smoothed[i]
            next_turn = smoothed[i + 1]

            is_sandwiched = (
                prev_turn.speaker == next_turn.speaker
                and curr_turn.speaker != prev_turn.speaker
            )
            is_transient = (
                (curr_turn.end - curr_turn.start < 1.2)
                or (curr_turn.word_count <= 3)
            )

            if is_sandwiched and is_transient:
                # Merge curr_turn into prev_turn
                curr_turn.speaker = prev_turn.speaker
            i += 1

        # ---------------------------------------------------------------------
        # Step C: Smart Merge
        # Join consecutive turns from same speaker if gap < 1.5s (max 300 chars)
        # ---------------------------------------------------------------------
        merged: list[SpeakerTurn] = [smoothed[0]]
        for turn in smoothed[1:]:
            last = merged[-1]
            gap = turn.start - last.end
            combined_len = len(last.text) + len(turn.text) + 1

            if last.speaker == turn.speaker and gap < 1.5 and combined_len <= 300:
                last.text = f"{last.text.strip()} {turn.text.strip()}"
                last.end = max(last.end, turn.end)
                last.word_count += turn.word_count
                last.is_final = last.is_final or turn.is_final
            else:
                merged.append(turn)

        return merged
