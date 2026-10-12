import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.providers.contracts import KnownSpeaker, StreamingOptions, STTProviderError
from app.providers.speechmatics import (
    SpeechmaticsProvider,
    SpeechmaticsStream,
    _batch_result,
)


def recognition(kind, start, end, content, speaker, confidence=0.9):
    alternative = SimpleNamespace(
        content=content,
        speaker=speaker,
        confidence=confidence,
        language="vi",
    )
    return SimpleNamespace(
        type=kind, start_time=start, end_time=end, alternatives=[alternative]
    )


def test_batch_groups_words_into_turns_and_maps_only_known_labels() -> None:
    profile_id = uuid4()
    known = (
        KnownSpeaker(profile_id, f"VP_{profile_id.hex}", "Huy", ("opaque",)),
    )
    transcript = SimpleNamespace(
        results=[
            recognition("word", 0.0, 0.4, "Xin", known[0].provider_label),
            recognition("word", 0.4, 0.8, "chào", known[0].provider_label),
            recognition("punctuation", 0.8, 0.81, ".", known[0].provider_label),
            recognition("word", 1.0, 1.4, "Tôi", "S1"),
            recognition("word", 1.4, 1.8, "đây", "S1"),
        ]
    )
    result = _batch_result(transcript, "vi", known)
    assert [item.text for item in result.segments] == ["Xin chào.", "Tôi đây"]
    assert result.segments[0].speaker_name == "Huy"
    assert result.segments[0].voice_profile_id == profile_id
    assert result.segments[0].is_identified is True
    assert result.segments[1].speaker_name is None
    assert result.segments[1].is_identified is False


class FakeVoiceClient:
    def __init__(self) -> None:
        self.handlers = {}
        self.connected = False
        self.disconnected = False
        self.sent = []

    def on(self, event, callback):
        self.handlers[str(getattr(event, "value", event))] = callback

    async def connect(self):
        self.connected = True

    async def send_audio(self, chunk):
        self.sent.append(chunk)

    async def disconnect(self):
        self.disconnected = True

    def emit(self, event: str, payload: dict):
        self.handlers[event](payload)


def test_provider_uses_adaptive_meeting_turn_configuration(tmp_path) -> None:
    async def scenario() -> None:
        captured = {}

        def factory(**kwargs):
            captured.update(kwargs)
            return FakeVoiceClient()

        provider = SpeechmaticsProvider(
            Settings(
                _env_file=None,
                speechmatics_api_key="key",
                media_storage_path=tmp_path,
            ),
            voice_client_factory=factory,
        )
        stream = await provider.open_stream(StreamingOptions("vi", True))
        config = captured["config"]
        assert config.end_of_utterance_mode.value == "adaptive"
        assert config.end_of_utterance_silence_trigger == 1.0
        assert config.max_delay == 1.5
        assert config.include_partials is True
        assert stream._finalization_delay_seconds == 0.75
        assert config.vad_config.enabled is True
        assert config.end_of_turn_config.use_forced_eou is True
        assert config.speech_segment_config.emit_sentences is False
        await stream.close()

    asyncio.run(scenario())


def test_stream_converts_partial_and_debounces_duplicate_finals() -> None:
    async def scenario() -> None:
        profile_id = uuid4()
        label = f"VP_{profile_id.hex}"
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client,
            StreamingOptions(
                "vi",
                True,
                known_speakers=(KnownSpeaker(profile_id, label, "Minh", ("opaque",)),),
            ),
            finalization_delay_seconds=0.01,
            max_segment_gap_seconds=1.0,
        )
        await stream.connect()
        payload = {
            "segments": [
                {
                    "speaker_id": label,
                    "language": "vi",
                    "text": "Xin chào",
                    "metadata": {"start_time": 1.25, "end_time": 2.5},
                }
            ]
        }
        client.emit("AddPartialSegment", payload)
        partial = await stream.pause()
        assert partial[0].type == "partial"
        assert partial[0].segment.start_ms == 1250
        assert partial[0].segment.speaker_name == "Minh"
        client.emit("AddSegment", payload)
        client.emit("AddSegment", payload)
        client.emit("EndOfTurn", {})
        previews = await stream.resume()
        assert previews and all(event.type == "partial" for event in previews)
        await asyncio.sleep(0.02)
        final = await stream.resume()
        assert len(final) == 1
        assert final[0].turn_order == 0
        assert final[0].segment.voice_profile_id == profile_id
        client.emit("AddSegment", payload)
        client.emit("EndOfTurn", {})
        assert await stream.pause() == ()
        assert await stream.close() == ()
        assert client.disconnected

    asyncio.run(scenario())


def test_stream_coalesces_same_speaker_fragments_but_preserves_turn_changes() -> None:
    async def scenario() -> None:
        profile_id = uuid4()
        label = f"VP_{profile_id.hex}"
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client,
            StreamingOptions(
                "vi",
                True,
                known_speakers=(KnownSpeaker(profile_id, label, "Minh", ("opaque",)),),
            ),
            finalization_delay_seconds=0.01,
            max_segment_gap_seconds=1.0,
        )
        await stream.connect()
        for segment in (
            {
                "speaker_id": label,
                "text": "Tôi là",
                "metadata": {"start_time": 3.0, "end_time": 3.6},
            },
            {
                "speaker_id": label,
                "text": "Minh.",
                "metadata": {"start_time": 3.65, "end_time": 4.1},
            },
            {
                "speaker_id": "S2",
                "text": "Xin chào",
                "metadata": {"start_time": 4.2, "end_time": 5.0},
            },
        ):
            client.emit("AddSegment", {"segments": [segment]})
            client.emit("EndOfTurn", {})
        await asyncio.sleep(0.02)
        events = [event for event in await stream.pause() if event.type == "final"]
        assert [event.segment.text for event in events] == ["Tôi là Minh.", "Xin chào"]
        assert events[0].segment.speaker_name == "Minh"
        assert events[0].turn_order == 0
        assert events[1].turn_order == 1

    asyncio.run(scenario())


def test_stream_flushes_last_pending_turn_on_close() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit(
            "AddSegment",
            {
                "segments": [
                    {
                        "speaker_id": "S1",
                        "text": "Lượt cuối",
                        "metadata": {"start_time": 8.0, "end_time": 9.0},
                    }
                ]
            },
        )
        preview = await stream.pause()
        assert len(preview) == 1 and preview[0].type == "partial"
        assert preview[0].segment.text == "Lượt cuối"
        events = await stream.close()
        assert [event.segment.text for event in events] == ["Lượt cuối"]
        assert events[0].turn_order == 0

    asyncio.run(scenario())


def test_stream_surfaces_provider_error_as_retryable() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("Error", {"reason": "connection lost"})
        with pytest.raises(STTProviderError) as caught:
            await stream.send_audio(b"audio")
        assert caught.value.retryable is True

    asyncio.run(scenario())


def test_receive_events_delivers_incremental_words_and_timer_final_without_audio() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=0.02
        )
        await stream.connect()
        for end, text in ((0.3, "Xin"), (0.6, "Xin chào"), (1.5, "Xin chào mọi người")):
            waiter = asyncio.create_task(stream.receive_events())
            await asyncio.sleep(0)
            client.emit("AddPartialSegment", {"segments": [{
                "speaker_id": "S1", "text": text,
                "metadata": {"start_time": 0, "end_time": end},
            }]})
            events = await asyncio.wait_for(waiter, 0.5)
            assert events[0].segment.text == text
            assert events[0].stream_segment_id == "turn:0"
            assert events[0].event_id
        client.emit("AddSegment", {"segments": [{
            "speaker_id": "S1", "text": "Xin chào mọi người.",
            "metadata": {"start_time": 0, "end_time": 1.5},
        }]})
        preview = await stream.receive_events()
        assert preview[0].type == "partial"
        final = await asyncio.wait_for(stream.receive_events(), 0.5)
        assert len(final) == 1 and final[0].type == "final"
        assert final[0].captured_at <= preview[0].captured_at
        assert client.sent == []
        assert await stream.close() == ()
    asyncio.run(scenario())


def test_cancelled_event_reader_preserves_output_for_close() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", False))
        await stream.connect()
        waiter = asyncio.create_task(stream.receive_events())
        await asyncio.sleep(0)
        waiter.cancel()
        await asyncio.gather(waiter, return_exceptions=True)
        client.emit("AddSegment", {"segments": [{
            "text": "Đoạn cuối", "metadata": {"start_time": 0, "end_time": 1},
        }]})
        events = await stream.close()
        assert [event.segment.text for event in events if event.type == "final"] == ["Đoạn cuối"]
    asyncio.run(scenario())


def _stream_payload(start: float, end: float, text: str, speaker: str = "S1") -> dict:
    return {"segments": [{
        "speaker_id": speaker, "text": text,
        "metadata": {"start_time": start, "end_time": end},
    }]}


def test_disjoint_partial_words_share_one_cumulative_preview_and_final() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        previews = []
        for start, end, text in ((0, .3, "Xin"), (.35, .65, "chào"), (.7, 1.2, "mọi người")):
            client.emit("AddPartialSegment", _stream_payload(start, end, text))
            previews.append((await stream.receive_events())[0])
        assert [event.segment.text for event in previews] == [
            "Xin", "Xin chào", "Xin chào mọi người",
        ]
        assert {event.stream_segment_id for event in previews} == {"turn:0"}
        client.emit("AddSegment", _stream_payload(0, 1.2, "Xin chào mọi người."))
        final = [event for event in await stream.close() if event.type == "final"]
        assert len(final) == 1
        assert final[0].segment.text == "Xin chào mọi người."
        assert final[0].stream_segment_id == previews[0].stream_segment_id

    asyncio.run(scenario())


def test_partial_timestamp_and_text_corrections_replace_snapshot_without_duplication() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("AddPartialSegment", _stream_payload(0, .3, "Xin cháo"))
        first = (await stream.receive_events())[0]
        client.emit("AddPartialSegment", _stream_payload(.04, .7, "Xin chào"))
        corrected = (await stream.receive_events())[0]
        assert corrected.stream_segment_id == first.stream_segment_id
        assert corrected.segment.text == "Xin chào"
        assert await stream.close() == ()  # A preview alone is never persisted.

    asyncio.run(scenario())


def test_continuing_partial_cancels_final_timer_until_tail_is_confirmed() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=.02,
        )
        await stream.connect()
        client.emit("AddSegment", _stream_payload(0, .3, "Xin"))
        first = (await stream.receive_events())[0]
        timer = stream._turns[0].flush_handle
        client.emit("AddPartialSegment", _stream_payload(.35, .7, "chào"))
        preview = (await stream.receive_events())[0]
        assert timer is not None and timer.cancelled()
        assert preview.segment.text == "Xin chào"
        assert preview.stream_segment_id == first.stream_segment_id
        client.emit("EndOfTurn", {})  # A delayed boundary cannot finalize the interim tail.
        await asyncio.sleep(.04)
        assert await stream.pause() == ()
        client.emit("AddSegment", _stream_payload(.35, .7, "chào."))
        assert (await stream.receive_events())[0].type == "partial"
        final = await asyncio.wait_for(stream.receive_events(), .5)
        assert len(final) == 1 and final[0].type == "final"
        assert final[0].segment.text == "Xin chào."
        assert final[0].stream_segment_id == first.stream_segment_id
        assert await stream.close() == ()

    asyncio.run(scenario())


def test_multiple_finals_resolve_one_cumulative_partial_snapshot() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=.02,
        )
        await stream.connect()
        client.emit("AddPartialSegment", _stream_payload(0, 1.2, "Xin chào mọi người"))
        await stream.receive_events()
        client.emit("AddSegment", _stream_payload(0, .3, "Xin"))
        await stream.receive_events()
        assert stream._turns[0].awaiting_final
        client.emit("AddSegment", _stream_payload(.35, 1.2, "chào mọi người."))
        preview = (await stream.receive_events())[0]
        assert preview.segment.text == "Xin chào mọi người."
        client.emit("AddPartialSegment", _stream_payload(0, 1.2, "Xin chào mọi người"))
        assert not stream._turns[0].awaiting_final
        final = await asyncio.wait_for(stream.receive_events(), .5)
        assert final[0].segment.text == "Xin chào mọi người."
        assert await stream.close() == ()

    asyncio.run(scenario())


def test_speaker_change_keeps_previews_separate_and_accepts_late_previous_final() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("AddPartialSegment", _stream_payload(0, .8, "Xin chào", "S1"))
        first = (await stream.receive_events())[0]
        client.emit("AddPartialSegment", _stream_payload(.9, 1.5, "Chào bạn", "S2"))
        second = (await stream.receive_events())[0]
        assert first.stream_segment_id != second.stream_segment_id
        client.emit("AddSegment", _stream_payload(0, .8, "Xin chào.", "S1"))
        previous = (await stream.receive_events())[0]
        assert previous.stream_segment_id == first.stream_segment_id
        client.emit("AddSegment", _stream_payload(.9, 1.5, "Chào bạn.", "S2"))
        final = [event for event in await stream.close() if event.type == "final"]
        assert [event.segment.text for event in final] == ["Xin chào.", "Chào bạn."]
        assert [event.stream_segment_id for event in final] == [
            first.stream_segment_id, second.stream_segment_id,
        ]

    asyncio.run(scenario())


def test_configured_audio_gap_creates_separate_durable_turns() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), max_segment_gap_seconds=.2,
        )
        await stream.connect()
        client.emit("AddSegment", _stream_payload(0, .5, "Câu trước."))
        client.emit("AddSegment", _stream_payload(.8, 1.3, "Câu sau."))
        final = [event for event in await stream.close() if event.type == "final"]
        assert [event.segment.text for event in final] == ["Câu trước.", "Câu sau."]
        assert len({event.stream_segment_id for event in final}) == 2

    asyncio.run(scenario())


def test_late_partial_cannot_reopen_a_finalized_turn() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=.02,
        )
        await stream.connect()
        client.emit("AddSegment", _stream_payload(0, .5, "Xin chào."))
        await stream.receive_events()
        assert (await asyncio.wait_for(stream.receive_events(), .5))[0].type == "final"
        client.emit("AddPartialSegment", _stream_payload(.04, .5, "Xin chào"))
        assert await stream.pause() == ()
        assert await stream.close() == ()

    asyncio.run(scenario())


def test_continuous_final_fragments_are_bounded_without_changing_speakers() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("AddSegment", _stream_payload(0, 30, "Đoạn dài."))
        client.emit("AddSegment", _stream_payload(30.05, 31, "Đoạn tiếp theo."))
        final = [event for event in await stream.close() if event.type == "final"]
        assert [event.segment.text for event in final] == ["Đoạn dài.", "Đoạn tiếp theo."]
        assert len({event.stream_segment_id for event in final}) == 2

    asyncio.run(scenario())


def test_close_with_unconfirmed_tail_persists_only_stable_words() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("AddSegment", _stream_payload(0, .3, "Xin"))
        client.emit("AddPartialSegment", _stream_payload(.35, .7, "chào"))
        final = [event for event in await stream.close() if event.type == "final"]
        assert [event.segment.text for event in final] == ["Xin"]
        assert not stream._turns

    asyncio.run(scenario())


def test_long_cumulative_snapshot_does_not_drop_separated_confirmed_fragments() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("AddPartialSegment", _stream_payload(0, 60, "Bản nháp của lượt nói dài"))
        client.emit("AddSegment", _stream_payload(0, .5, "Đầu câu"))
        client.emit("AddSegment", _stream_payload(59, 60, "cuối câu."))
        final = [event for event in await stream.close() if event.type == "final"]
        assert [event.segment.text for event in final] == ["Đầu câu cuối câu."]
        assert final[0].segment.end_ms == 60_000

    asyncio.run(scenario())


def test_returning_speaker_does_not_reuse_an_old_unresolved_turn() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=.02,
        )
        await stream.connect()
        client.emit("AddPartialSegment", _stream_payload(0, .5, "Lượt trước", "S1"))
        first = (await stream.receive_events())[0]
        client.emit("AddSegment", _stream_payload(.55, 1, "Người khác.", "S2"))
        await stream.receive_events()
        assert (await asyncio.wait_for(stream.receive_events(), .5))[0].type == "final"
        client.emit("AddPartialSegment", _stream_payload(1.05, 1.2, "Lượt sau", "S1"))
        returning = (await stream.receive_events())[0]
        assert returning.stream_segment_id != first.stream_segment_id
        assert returning.segment.text == "Lượt sau"
        client.emit("AddSegment", _stream_payload(0, .5, "Lượt trước.", "S1"))
        client.emit("AddSegment", _stream_payload(1.05, 1.2, "Lượt sau.", "S1"))
        final = [event for event in await stream.close() if event.type == "final"]
        assert [event.segment.text for event in final] == ["Lượt trước.", "Lượt sau."]

    asyncio.run(scenario())


@pytest.mark.parametrize("boundary", ["same_words", "is_eou", "end_of_turn"])
def test_shortened_final_timing_resolves_stale_snapshot_without_waiting_forever(boundary) -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=.02,
        )
        await stream.connect()
        draft = "Xin chào" if boundary == "same_words" else "Xin chào nhé"
        client.emit("AddPartialSegment", _stream_payload(0, 1.5, draft))
        first = (await stream.receive_events())[0]
        payload = _stream_payload(.04, 1.1, "Xin chào.")
        if boundary == "is_eou":
            payload["segments"][0]["is_eou"] = True
        client.emit("AddSegment", payload)
        if boundary == "end_of_turn":
            client.emit("EndOfTurn", {"metadata": {"start_time": 0, "end_time": 1.1}})
        assert not stream._turns[0].awaiting_final
        await stream.receive_events()  # Immediate preview of the stable text.
        final = await asyncio.wait_for(stream.receive_events(), .5)
        assert len(final) == 1 and final[0].type == "final"
        assert final[0].segment.text == "Xin chào."
        assert final[0].segment.end_ms == 1100
        assert final[0].stream_segment_id == first.stream_segment_id
        assert await stream.close() == ()

    asyncio.run(scenario())


def test_delayed_end_boundary_preserves_additional_newer_partial_words() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(
            client, StreamingOptions("vi", True), finalization_delay_seconds=.02,
        )
        await stream.connect()
        client.emit("AddSegment", _stream_payload(0, 1.1, "Xin"))
        await stream.receive_events()
        client.emit("AddPartialSegment", _stream_payload(0, 1.2, "Xin chào"))
        preview = (await stream.receive_events())[0]
        assert preview.segment.text == "Xin chào"
        client.emit("EndOfTurn", {"metadata": {"start_time": 0, "end_time": 1.1}})
        assert stream._turns[0].awaiting_final
        await asyncio.sleep(.04)
        assert await stream.pause() == ()
        client.emit("AddSegment", _stream_payload(1.12, 1.2, "chào."))
        await stream.receive_events()
        final = await asyncio.wait_for(stream.receive_events(), .5)
        assert final[0].segment.text == "Xin chào."
        assert await stream.close() == ()

    asyncio.run(scenario())


def test_end_boundary_cannot_promote_text_without_any_provider_final() -> None:
    async def scenario() -> None:
        client = FakeVoiceClient()
        stream = SpeechmaticsStream(client, StreamingOptions("vi", True))
        await stream.connect()
        client.emit("AddPartialSegment", _stream_payload(0, 1.2, "Chưa xác nhận"))
        await stream.receive_events()
        client.emit("EndOfTurn", {"metadata": {"start_time": 0, "end_time": 1.2}})
        assert stream._turns[0].awaiting_final
        assert await stream.close() == ()

    asyncio.run(scenario())
