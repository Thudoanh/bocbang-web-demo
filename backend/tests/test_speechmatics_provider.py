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
            assert events[0].stream_segment_id == "0:S1"
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
