import pytest
from app.providers.contracts import TranscriptionSegment
from app.services.sentence_merger import (
    clean_false_periods,
    merge_fragmented_segments,
    merge_text,
    prune_minor_speakers,
)


def test_clean_false_periods() -> None:
    assert clean_false_periods("Sau. Hai.") == "Sau hai."
    assert clean_false_periods("Cũng tại hai.") == "Cũng tại hai."
    assert clean_false_periods("Ta không môn đăng hộ.") == "Ta không môn đăng hộ."
    assert clean_false_periods("Đối.") == "Đối."


def test_merge_text() -> None:
    # Test incremental merge of false period fragments
    t1 = merge_text("Sau. Hai.", "Đêm.")
    assert t1 == "Sau hai đêm"
    t2 = merge_text(t1, "Sinh hoạt.")
    assert t2 == "Sau hai đêm sinh hoạt"


def test_fragmented_12_segments_merge_into_single_sentence() -> None:
    # User's exact prompt example 1:
    # ["Sau. Hai.", "Đêm.", "Sinh hoạt.", "Trên đường phố.", "Thì.", "Tôi.", "Đã có thể theo.", "Đi về nhà", "Nói.", "Chuyện.", "Qua.", "Về."]
    raw_texts = [
        "Sau. Hai.",
        "Đêm.",
        "Sinh hoạt.",
        "Trên đường phố.",
        "Thì.",
        "Tôi.",
        "Đã có thể theo.",
        "Đi về nhà",
        "Nói.",
        "Chuyện.",
        "Qua.",
        "Về.",
    ]
    # Simulate fragmented speech where each fragment starts 300ms after previous ends (< 2.2s gap)
    segments = []
    current_time = 1000
    for idx, text in enumerate(raw_texts):
        dur = len(text.split()) * 300 + 400
        # Spurious speaker IDs jumping to S3, S4...
        spk = f"speaker_{idx + 1}"
        segments.append(
            TranscriptionSegment(
                start_ms=current_time,
                end_ms=current_time + dur,
                text=text,
                speaker_label=spk,
            )
        )
        current_time += dur + 250  # 250ms gap (< 2.2s)

    merged = merge_fragmented_segments(segments)
    assert len(merged) == 1, f"Expected 1 merged segment, got {len(merged)}: {[s.text for s in merged]}"
    expected = "Sau hai đêm sinh hoạt trên đường phố thì tôi đã có thể theo đi về nhà nói chuyện qua về."
    assert merged[0].text == expected
    assert merged[0].speaker_label == "speaker_1"


def test_fragmented_false_periods_example_2() -> None:
    # User's exact prompt example 2:
    # ["Cũng tại hai.", "Ta không môn đăng hộ.", "Đối."]
    raw_texts = ["Cũng tại hai.", "Ta không môn đăng hộ.", "Đối."]
    segments = []
    current_time = 2000
    for idx, text in enumerate(raw_texts):
        dur = len(text.split()) * 300 + 400
        spk = f"speaker_{idx + 1}"
        segments.append(
            TranscriptionSegment(
                start_ms=current_time,
                end_ms=current_time + dur,
                text=text,
                speaker_label=spk,
            )
        )
        current_time += dur + 300

    merged = merge_fragmented_segments(segments)
    assert len(merged) == 1, f"Expected 1 merged segment, got {len(merged)}"
    assert merged[0].text == "Cũng tại hai ta không môn đăng hộ đối."
    assert merged[0].speaker_label == "speaker_1"


def test_split_on_large_silence_gap() -> None:
    # Should split when silence gap >= 2.2s (2200ms)
    s1 = TranscriptionSegment(start_ms=1000, end_ms=3000, text="Xin chào bạn.", speaker_label="speaker_1")
    s2 = TranscriptionSegment(start_ms=5500, end_ms=8000, text="Tôi là AI.", speaker_label="speaker_1")  # gap = 2500ms >= 2200ms
    merged = merge_fragmented_segments([s1, s2])
    assert len(merged) == 2
    assert merged[0].text == "Xin chào bạn."
    assert merged[1].text == "Tôi là AI."


def test_split_on_different_speaker_with_at_least_5_words() -> None:
    # Should split when a different speaker speaks >= 5 words in a conversation
    s1 = TranscriptionSegment(start_ms=1000, end_ms=5000, text="Xin chào tất cả các bạn đã đến với buổi họp hôm nay.", speaker_label="speaker_1")
    s2 = TranscriptionSegment(start_ms=5500, end_ms=9000, text="Cảm ơn bạn chúng tôi đã sẵn sàng bắt đầu thảo luận.", speaker_label="speaker_2")
    merged = merge_fragmented_segments([s1, s2])
    assert len(merged) == 2
    assert merged[0].speaker_label == "speaker_1"
    assert merged[1].speaker_label == "speaker_2"
