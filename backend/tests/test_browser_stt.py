from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.providers.browser import BrowserSTTStream, BrowserTranscriptMessage
from app.providers.contracts import TranslationCapabilities
from test_realtime import _app, _verified_session, _create_realtime_meeting


class ForbiddenCloudSTT:
    def capabilities(self):
        raise AssertionError("Browser mode must never access Cloud STT")


class FakeTranslator:
    def capabilities(self):
        return TranslationCapabilities(frozenset({("vi", "en")}))

    async def translate_segments(self, segments, source, target):
        return tuple(replace(item, text="Hello everyone") for item in segments)


def create_browser(client, token, **overrides):
    return client.post("/api/v1/meetings", headers={"Authorization": f"Bearer {token}"}, json={
        "title": "Browser meeting", "source_type": "realtime", "language_mode": "auto",
        "stt_mode": "browser", "diarization_enabled": True, **overrides,
    })


def test_browser_persists_final_and_keeps_cloud_translation(tmp_path):
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = ForbiddenCloudSTT()
    app.state.translation_provider = FakeTranslator()
    app.state.enqueue_job = lambda *args: None
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        created = create_browser(client, token)
        assert created.status_code == 201
        assert created.json()["language_mode"] == "vi"
        assert created.json()["diarization_enabled"] is False
        meeting_id = created.json()["id"]
        with client.websocket_connect(f"/api/v1/realtime/{meeting_id}?access_token={token}") as ws:
            ready = ws.receive_json()
            assert ready["provider"] == "browser-web-speech"
            assert ready["speaker_identification_available"] is False
            ws.send_bytes(bytes(32_000))
            message = {"type": "transcript.browser", "result_id": "turn:0", "final": False,
                       "text": "Xin chào", "start_ms": 0, "end_ms": 600}
            ws.send_json(message)
            partial = ws.receive_json()
            assert partial["type"] == "transcript.partial"
            ws.send_json({**message, "recognition_status": "unconfirmed"})
            unfinished = ws.receive_json()
            assert unfinished["type"] == "transcript.partial"
            assert unfinished["recognition_status"] == "unconfirmed"
            assert unfinished["stream_segment_id"] == partial["stream_segment_id"]
            ws.send_json({**message, "result_id": "turn:1", "text": "", "recognition_status": "withdrawn"})
            withdrawn = ws.receive_json()
            assert withdrawn["type"] == "transcript.partial"
            assert withdrawn["text"] == ""
            assert withdrawn["recognition_status"] == "withdrawn"
            # No transcript/version exists until the first final is committed.
            assert client.get(f"/api/v1/meetings/{meeting_id}/transcript", headers=headers).status_code == 404
            ws.send_json({"type": "translation.enable", "target_language": "en"})
            assert ws.receive_json()["type"] == "translation.status"
            final_message = {**message, "final": True, "text": "Xin chào mọi người", "end_ms": 1000}
            ws.send_json(final_message)
            final = ws.receive_json()
            assert final["type"] == "transcript.final"
            assert final["stream_segment_id"] == partial["stream_segment_id"]
            translated = ws.receive_json()
            assert translated["type"] == "translation.final"
            assert translated["text"] == "Hello everyone"
            # A duplicate final must not create a second row or invoke translation twice.
            ws.send_json(final_message)
            ws.send_json({"type": "recording.pause", "acknowledge": True})
            assert ws.receive_json()["type"] == "recording.paused"
            change = client.patch(f"/api/v1/meetings/{meeting_id}", headers=headers, json={"stt_mode": "cloud"})
            assert change.status_code == 409
            ws.send_json({"type": "recording.resume", "acknowledge": True})
            assert ws.receive_json()["type"] == "recording.resumed"
            ws.send_json({"type": "recording.stop"})
            assert ws.receive_json()["type"] == "meeting.status"
        transcript = client.get(f"/api/v1/meetings/{meeting_id}/transcript", headers=headers).json()
        assert len(transcript["segments"]) == 1
        assert transcript["segments"][0]["text"] == "Xin chào mọi người"
        saved = client.get(f"/api/v1/meetings/{meeting_id}", headers=headers).json()
        assert saved["stt_mode"] == "browser"
        assert saved["status"] == "completed"
        translations = client.get(f"/api/v1/meetings/{meeting_id}/translations", headers=headers).json()
        assert translations[0]["segments"][0]["text"] == "Hello everyone"


def test_mode_defaults_and_unimplemented_modes(tmp_path):
    app, sender, _ = _app(tmp_path)
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting_id = _create_realtime_meeting(client, token)
        assert client.get(f"/api/v1/meetings/{meeting_id}", headers=headers).json()["stt_mode"] == "cloud"
        assert create_browser(client, token, stt_mode="local").status_code == 422
        assert create_browser(client, token, source_type="upload").status_code == 422
        assert client.patch(f"/api/v1/meetings/{meeting_id}", headers=headers, json={"stt_mode": "browser"}).status_code == 200
        assert client.patch(f"/api/v1/meetings/{meeting_id}", headers=headers, json={"stt_mode": None}).status_code == 422
        assert client.patch(f"/api/v1/meetings/{meeting_id}", json={"stt_mode": "cloud"}).status_code == 401
        with client.websocket_connect(f"/api/v1/realtime/{meeting_id}") as ws:
            assert ws.receive_json()["code"] == "AUTH_REQUIRED"


def test_browser_payload_cannot_spoof_speakers_or_exceed_audio():
    message = {"type": "transcript.browser", "result_id": "turn:0", "final": True,
               "text": "Hello", "start_ms": 0, "end_ms": 1000}
    with pytest.raises(ValidationError):
        BrowserTranscriptMessage.model_validate({**message, "speaker_name": "Fake speaker"})
    with pytest.raises(ValidationError):
        BrowserTranscriptMessage.model_validate({**message, "end_ms": -1})
    with pytest.raises(ValueError):
        BrowserSTTStream("en").accept(BrowserTranscriptMessage.model_validate(message), -1000)


@pytest.mark.parametrize("overrides", [
    {"recognition_status": "unconfirmed"},
    {"recognition_status": "withdrawn", "text": ""},
    {"final": False, "text": ""},
    {"final": False, "recognition_status": "withdrawn"},
])
def test_draft_status_cannot_be_misrepresented_as_a_final(overrides):
    message = {"type": "transcript.browser", "result_id": "turn:0", "final": True,
               "text": "Hello", "start_ms": 0, "end_ms": 1000}
    with pytest.raises(ValidationError):
        BrowserTranscriptMessage.model_validate({**message, **overrides})
