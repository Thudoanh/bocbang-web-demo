"""Smart Sentence Merger and Speaker Stabilization Refiner.

Eliminates false periods, merges fragmented 1-3 word utterances into fluent
sentences, and prevents hallucinated speaker changes (e.g. Người nói 3-10).
"""

from __future__ import annotations

import re
from typing import Sequence
from app.providers.contracts import TranscriptionSegment

VIETNAMESE_PROPER_NOUNS = frozenset(
    [
        "hà nội", "hồ chí minh", "đà nẵng", "việt nam", "sài gòn", "huế",
        "hải phòng", "cần thơ", "nha trang", "đà lạt", "vũng tàu", "quy nhơn",
        "google", "speechmatics", "groq", "openai", "whisper", "youtube",
        "facebook", "microsoft", "apple", "zalo", "tiktok", "meet", "zoom",
        "i",
    ]
)

DANGLING_CONNECTORS = frozenset(
    [
        "hai", "ba", "tại", "thì", "và", "của", "là", "đã", "đang", "sẽ",
        "để", "vì", "do", "ở", "trên", "dưới", "trong", "qua", "với", "như",
        "nhưng", "rằng", "bởi", "nên", "cho", "mới", "theo", "hộ", "đăng",
    ]
)


def lower_first_char_if_not_proper(word: str) -> str:
    """Lowercases the first letter of a word unless it is a recognized proper noun, acronym, or pronoun."""
    if not word:
        return ""
    clean = word.strip()
    if clean.lower() in VIETNAMESE_PROPER_NOUNS or clean == "I":
        return clean
    if clean.isupper() and len(clean) > 1:
        return clean
    return clean[0].lower() + clean[1:]


def clean_false_periods(text: str) -> str:
    """Removes false internal periods in fragmented words (e.g., 'Sau. Hai.' -> 'Sau hai')."""
    def _fix_internal_period(m: re.Match[str]) -> str:
        w1 = m.group(1)
        w2 = m.group(2)
        return f"{w1} {lower_first_char_if_not_proper(w2)}"

    cleaned = re.sub(r"(\b\w+)\.\s+([A-Za-zÀ-ỹĐđ]\w*\b)", _fix_internal_period, text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def strip_trailing_period(text: str) -> str:
    """Strips trailing period and extra whitespace."""
    return re.sub(r"\.+$", "", text.strip()).strip()


def merge_text(prev: str, next_text: str) -> str:
    """Merges two consecutive text fragments cleanly without false periods."""
    clean_prev = strip_trailing_period(clean_false_periods(prev))
    clean_next = strip_trailing_period(clean_false_periods(next_text))
    words = clean_next.split()
    if words:
        words[0] = lower_first_char_if_not_proper(words[0])
    joined_next = " ".join(words)
    return f"{clean_prev} {joined_next}".strip()


def prune_minor_speakers(
    segments: Sequence[TranscriptionSegment],
    min_total_words: int = 15,
) -> list[TranscriptionSegment]:
    """Prunes spurious speakers with fewer than min_total_words across the entire recording.
    
    Spurious speakers (e.g. Người nói 3, 4... spawned by a 1-word whisper or cough)
    are merged into the temporally nearest dominant speaker.
    """
    if not segments:
        return []

    speaker_word_counts: dict[str, int] = {}
    max_turn_per_speaker: dict[str, int] = {}
    for s in segments:
        label = s.speaker_label or "speaker_1"
        word_count = len(s.text.split())
        speaker_word_counts[label] = speaker_word_counts.get(label, 0) + word_count
        max_turn_per_speaker[label] = max(max_turn_per_speaker.get(label, 0), word_count)

    first_speaker = segments[0].speaker_label or "speaker_1"
    total_words = sum(speaker_word_counts.values())

    dominant_speakers = set()
    for label, count in speaker_word_counts.items():
        # In a long recording, require >= 15 words. In short test samples, require >= 6 words turn.
        if count >= min_total_words:
            dominant_speakers.add(label)
        elif total_words >= min_total_words and max_turn_per_speaker.get(label, 0) >= 6:
            dominant_speakers.add(label)

    dominant_speakers.add(first_speaker)
    last_dominant = first_speaker

    reassigned: list[TranscriptionSegment] = []
    for s in segments:
        label = s.speaker_label or "speaker_1"
        if label in dominant_speakers:
            last_dominant = label
            reassigned.append(s)
        else:
            reassigned.append(
                TranscriptionSegment(
                    start_ms=s.start_ms,
                    end_ms=s.end_ms,
                    text=s.text,
                    speaker_label=last_dominant,
                    confidence=s.confidence,
                    speaker_name=s.speaker_name,
                    voice_profile_id=s.voice_profile_id,
                    is_identified=s.is_identified,
                )
            )
    return reassigned


def merge_fragmented_segments(
    segments: Sequence[TranscriptionSegment],
    *,
    min_card_words: int = 12,
    max_card_words: int = 35,
    min_card_duration_ms: int = 5000,
    max_silence_gap_ms: int = 2200,
    min_turn_words: int = 5,
) -> tuple[TranscriptionSegment, ...]:
    """Merges fragmented speech into natural, readable, unified sentences."""
    if not segments:
        return ()

    stabilized = prune_minor_speakers(segments, min_total_words=15)
    merged: list[TranscriptionSegment] = []
    current: TranscriptionSegment | None = None

    for seg in stabilized:
        if not seg.text or not seg.text.strip():
            continue

        if current is None:
            cleaned = clean_false_periods(seg.text.strip())
            current = TranscriptionSegment(
                start_ms=seg.start_ms,
                end_ms=seg.end_ms,
                text=cleaned,
                speaker_label=seg.speaker_label,
                confidence=seg.confidence,
                speaker_name=seg.speaker_name,
                voice_profile_id=seg.voice_profile_id,
                is_identified=seg.is_identified,
            )
            continue

        gap_ms = seg.start_ms - current.end_ms
        curr_words = len(current.text.split())
        curr_duration_ms = current.end_ms - current.start_ms
        next_words = len(seg.text.split())
        is_same_speaker = (seg.speaker_label == current.speaker_label)

        # Check if current ends with an incomplete dangling connector (e.g. "Cũng tại hai", "Ta không môn đăng hộ")
        last_word = strip_trailing_period(current.text).split()[-1].lower() if current.text.split() else ""
        is_dangling = (last_word in DANGLING_CONNECTORS) and (gap_ms < 2000)

        # Speaker Inertia Lock: If next segment has < min_turn_words (5 words),
        # it cannot trigger a speaker change.
        if not is_same_speaker and next_words < min_turn_words and gap_ms < max_silence_gap_ms:
            is_same_speaker = True

        if is_dangling:
            should_split = False
        else:
            has_true_punctuation = current.text.endswith((".", "?", "!"))
            cond_a = (curr_words >= min_card_words or curr_duration_ms >= min_card_duration_ms) and has_true_punctuation and (curr_words >= max_card_words or gap_ms >= 1000)
            cond_b = gap_ms >= max_silence_gap_ms
            cond_c = (not is_same_speaker) and (next_words >= min_turn_words)
            should_split = cond_a or cond_b or cond_c

        if should_split:
            final_text = clean_false_periods(current.text)
            if not final_text.endswith((".", "?", "!")):
                final_text += "."
            merged.append(
                TranscriptionSegment(
                    start_ms=current.start_ms,
                    end_ms=current.end_ms,
                    text=final_text,
                    speaker_label=current.speaker_label,
                    confidence=current.confidence,
                    speaker_name=current.speaker_name,
                    voice_profile_id=current.voice_profile_id,
                    is_identified=current.is_identified,
                )
            )
            cleaned = clean_false_periods(seg.text.strip())
            current = TranscriptionSegment(
                start_ms=seg.start_ms,
                end_ms=seg.end_ms,
                text=cleaned,
                speaker_label=seg.speaker_label,
                confidence=seg.confidence,
                speaker_name=seg.speaker_name,
                voice_profile_id=seg.voice_profile_id,
                is_identified=seg.is_identified,
            )
        else:
            combined_text = merge_text(current.text, seg.text)
            avg_conf = None
            if current.confidence is not None and seg.confidence is not None:
                avg_conf = round((current.confidence + seg.confidence) / 2, 3)
            elif current.confidence is not None:
                avg_conf = current.confidence
            elif seg.confidence is not None:
                avg_conf = seg.confidence

            current = TranscriptionSegment(
                start_ms=current.start_ms,
                end_ms=max(current.end_ms, seg.end_ms),
                text=combined_text,
                speaker_label=current.speaker_label,
                confidence=avg_conf,
                speaker_name=current.speaker_name or seg.speaker_name,
                voice_profile_id=current.voice_profile_id or seg.voice_profile_id,
                is_identified=current.is_identified or seg.is_identified,
            )

    if current is not None:
        final_text = clean_false_periods(current.text)
        if not final_text.endswith((".", "?", "!")):
            final_text += "."
        merged.append(
            TranscriptionSegment(
                start_ms=current.start_ms,
                end_ms=current.end_ms,
                text=final_text,
                speaker_label=current.speaker_label,
                confidence=current.confidence,
                speaker_name=current.speaker_name,
                voice_profile_id=current.voice_profile_id,
                is_identified=current.is_identified,
            )
        )

    return tuple(merged)
