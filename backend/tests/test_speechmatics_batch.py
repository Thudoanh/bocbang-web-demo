import asyncio
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.providers.speechmatics import SpeechmaticsProvider, _batch_result
from test_speechmatics_provider import recognition


def test_short_reply_and_zero_duration_punctuation_keep_their_speakers():
    transcript = SimpleNamespace(results=[
        recognition("word", 0, 1, "Bạn đồng ý với đề xuất này", "S1"),
        recognition("punctuation", 1, 1, "?", "UU"),
        recognition("word", 1.1, 1.4, "Dạ", "S2"),
        recognition("punctuation", 1.4, 1.4, ".", "UU"),
        recognition("word", 1.5, 3, "Vậy chúng ta thống nhất", "S1"),
        recognition("punctuation", 3, 3, ".", "UU"),
    ])
    result = _batch_result(transcript, "auto", ())
    assert result.language == "vi"
    assert [s.text for s in result.segments] == ["Bạn đồng ý với đề xuất này?", "Dạ.", "Vậy chúng ta thống nhất."]
    assert [s.speaker_label for s in result.segments] == ["speaker_1", "speaker_2", "speaker_1"]
    assert [(s.start_ms, s.end_ms) for s in result.segments] == [(0, 1000), (1100, 1400), (1500, 3000)]


@pytest.mark.parametrize("language, expected", [(None, "auto"), ("auto", "auto"), ("vi", "vi"), ("en-US", "en")])
def test_batch_submits_once_with_native_language_and_independent_diarization(tmp_path, language, expected):
    captured = {}

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def submit_job(self, source, **kwargs):
            captured["calls"] = captured.get("calls", 0) + 1
            captured["config"] = kwargs["transcription_config"].to_dict()
            return SimpleNamespace(id="test-batch-job")

        async def wait_for_completion(self, job_id, **kwargs):
            captured["wait"] = kwargs
            word = recognition("word", 0, 1, "Hello", "S1")
            word.alternatives[0].language = "en"
            return SimpleNamespace(results=[word])

    source = tmp_path/"audio.wav"
    source.write_bytes(b"audio")
    provider = SpeechmaticsProvider(Settings(_env_file=None, speechmatics_api_key="test-key",
        speechmatics_speaker_sensitivity=0.1, speechmatics_prefer_current_speaker=True,
        stt_poll_timeout_seconds=123), batch_client_factory=Client)
    result = asyncio.run(provider.transcribe_file(source, language))
    config = captured["config"]
    assert captured["calls"] == 1
    assert config["language"] == expected
    assert config["model"] == "enhanced"
    assert "language_hints" not in config
    assert "language_hints_strict" not in config
    assert config["diarization"] == "speaker"
    assert config["speaker_diarization_config"] == {"speaker_sensitivity": 0.5, "prefer_current_speaker": False}
    assert captured["wait"]["timeout"] == 123
    assert result.language == "en"


def test_unknown_speaker_word_remains_unknown_instead_of_becoming_first_speaker():
    result = _batch_result(SimpleNamespace(results=[
        recognition("word", 0, 1, "Xin chào", "S1"),
        recognition("word", 1.1, 1.5, "không rõ", "UU"),
        recognition("word", 1.6, 2.5, "Chào bạn", "S2"),
    ]), "vi", ())
    assert [s.speaker_label for s in result.segments] == ["speaker_1", None, "speaker_2"]


@pytest.mark.parametrize("selected,language,has_identity,model,wire_language", [
    ("auto", "auto", False, "melia-1", "multi"),
    ("auto", "vi", False, "melia-1", "multi"),
    ("auto", "auto", True, "enhanced", "auto"),
    ("melia-1", "en", True, "enhanced", "en"),
    ("enhanced", "en", False, "enhanced", "en"),
    ("standard", "vi", False, "standard", "vi"),
    ("standard", "vi", True, "standard", "vi"),
])
def test_model_selection_keeps_diarization_and_preserves_registered_identity(tmp_path, selected, language, has_identity, model, wire_language):
    from uuid import uuid4
    from app.providers.contracts import KnownSpeaker
    captured = {}
    profile = KnownSpeaker(uuid4(), "VP_test", "Test speaker", ("opaque-id",))

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def submit_job(self, source, **kwargs):
            captured.update(kwargs["transcription_config"].to_dict())
            return SimpleNamespace(id="model-test")

        async def wait_for_completion(self, *args, **kwargs):
            return SimpleNamespace(results=[recognition("word", 0, 1, "Xin chào", profile.provider_label if has_identity else "S1", confidence=None)])

    source = tmp_path/"original.m4a"
    source.write_bytes(b"audio")
    provider = SpeechmaticsProvider(Settings(_env_file=None, speechmatics_api_key="test",
        speechmatics_batch_model=selected), batch_client_factory=Client)
    result = asyncio.run(provider.transcribe_file(source, language, (profile,) if has_identity else ()))
    assert captured["model"] == model and captured["language"] == wire_language
    assert captured["diarization"] == "speaker"
    if model == "melia-1" and language == "vi":
        assert captured["language_hints"] == ["vi"] and captured["language_hints_strict"] is True
    if has_identity:
        assert result.segments[0].voice_profile_id == profile.profile_id
        assert result.segments[0].speaker_name == profile.name
    assert result.provider_metadata["model"] == model
    assert result.provider_metadata["job_id"] == "model-test"
    assert result.provider_metadata["submit_ms"] >= 0 and result.provider_metadata["wait_ms"] >= 0


def test_enrollment_uses_enhanced_even_when_default_is_auto(tmp_path):
    captured = {}

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def submit_job(self, source, **kwargs):
            captured.update(kwargs["transcription_config"].to_dict())
            return SimpleNamespace(id="enroll")

        async def wait_for_completion(self, *args, **kwargs):
            return SimpleNamespace(results=[recognition("word", 0, 1, "Xin chào", "S1")],
                speakers=[SimpleNamespace(speaker_identifiers=["opaque-id"])])

    source = tmp_path/"voice.wav"
    source.write_bytes(b"audio")
    provider = SpeechmaticsProvider(Settings(_env_file=None, speechmatics_api_key="test", speechmatics_batch_model="auto"), batch_client_factory=Client)
    result = asyncio.run(provider.enroll_speaker(source, "vi"))
    assert captured["model"] == "enhanced"
    assert captured["speaker_diarization_config"]["get_speakers"] is True
    assert result.speaker_identifiers == ("opaque-id",)
