"""Speaker ingestion, reconnect isolation, correction history and user edits."""

from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_realtime import FakeProvider, _app, _create_realtime_meeting, _verified_session

from app.providers.contracts import (
    StreamingSpeakerRevision,
    StreamingTranscriptionEvent,
    TranscriptionSegment,
)


def final(order: int, label: str | None, start: int = 0):
    return StreamingTranscriptionEvent(
        "final", "vi", TranscriptionSegment(start, start + 900, f"Turn {order}", label), order
    )


class SpeakerStream:
    def __init__(self, batches, revisions=()):
        self.batches = iter(batches)
        self.revisions = revisions

    async def send_audio(self, chunk):
        return next(self.batches)

    async def pause(self):
        return ()

    async def resume(self):
        return ()

    async def close(self):
        return self.revisions


def connect(client, meeting_id, token):
    return client.websocket_connect(
        f"/api/v1/realtime/{meeting_id}?access_token={token}"
    )


def test_speaker_revisions_persist_history_and_reconnect_isolates_labels(tmp_path: Path):
    app, sender, _ = _app(tmp_path)
    provider = FakeProvider()
    app.state.stt_provider = provider
    provider.stream = SpeakerStream(
        [(final(0, "A"), final(1, "B", 900), final(2, None, 1800))],
        (StreamingSpeakerRevision(0, "B"), StreamingSpeakerRevision(0, "B"),
         StreamingSpeakerRevision(2, "A"),
         StreamingSpeakerRevision(99, "C")),
    )
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting = _create_realtime_meeting(client, token)
        with connect(client, meeting, token) as ws:
            assert ws.receive_json()["type"] == "session.ready"
            ws.send_bytes(b"audio")
            first, second, pending = (ws.receive_json() for _ in range(3))
            assert first["speaker_id"] != second["speaker_id"]
            assert "speaker_id" not in pending
            original = client.get(f"/api/v1/meetings/{meeting}/transcript", headers=headers).json()
            speakers = client.get(f"/api/v1/meetings/{meeting}/speakers", headers=headers).json()
            assert {s["name"] for s in speakers} == {"Người nói 1", "Người nói 2"}
            ws.send_text('{"type":"recording.stop"}')
            correction, resolved = ws.receive_json(), ws.receive_json()
            assert correction["type"] == "transcript.speaker_updated"
            assert correction["logical_segment_id"] == first["logical_segment_id"]
            assert correction["speaker_id"] == second["speaker_id"]
            assert resolved["speaker_id"] == first["speaker_id"]
            assert ws.receive_json()["type"] == "meeting.status"
        current = client.get(f"/api/v1/meetings/{meeting}/transcript", headers=headers).json()
        assert [s["speaker_id"] for s in current["segments"]] == [
            second["speaker_id"], second["speaker_id"], first["speaker_id"],
        ]
        old = client.get(
            f"/api/v1/meetings/{meeting}/transcript/versions/{original['version_id']}",
            headers=headers,
        ).json()
        assert old["segments"][0]["speaker_id"] == first["speaker_id"]
        assert old["segments"][2]["speaker_id"] is None
        provider.stream = SpeakerStream([(final(0, "A"),)])
        with connect(client, meeting, token) as ws:
            ws.receive_json()
            ws.send_bytes(b"audio")
            reconnected = ws.receive_json()
            assert reconnected["speaker_id"] not in {first["speaker_id"], second["speaker_id"]}
            assert reconnected["start_ms"] == 2700
            ws.send_text('{"type":"recording.stop"}')
            assert ws.receive_json()["type"] == "meeting.status"
        current = client.get(f"/api/v1/meetings/{meeting}/transcript", headers=headers).json()
        assert len(current["segments"]) == 4
        history = client.get(
            f"/api/v1/meetings/{meeting}/transcript/versions/{current['version_id']}",
            headers=headers,
        ).json()
        assert history["segments"] == current["segments"]


@pytest.mark.parametrize("manual", ["same", "different", "unassigned"])
def test_provider_revision_preserves_manual_speaker_choice(tmp_path: Path, manual):
    app, sender, _ = _app(tmp_path)
    provider = FakeProvider()
    provider.stream = SpeakerStream(
        [(final(0, "A"),)], (StreamingSpeakerRevision(0, "B"),)
    )
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting = _create_realtime_meeting(client, token)
        with connect(client, meeting, token) as ws:
            ws.receive_json()
            ws.send_bytes(b"audio")
            first = ws.receive_json()
            chosen = first["speaker_id"] if manual == "same" else None
            if manual == "different":
                chosen = client.post(
                    f"/api/v1/meetings/{meeting}/speakers", headers=headers,
                    json={"name": "Alice"},
                ).json()["id"]
            result = client.patch(
                f"/api/v1/segments/{first['logical_segment_id']}/speaker", headers=headers,
                json={"speaker_id": chosen},
            )
            assert result.status_code == 200
            ws.send_text('{"type":"recording.stop"}')
            assert ws.receive_json()["type"] == "meeting.status"
        current = client.get(f"/api/v1/meetings/{meeting}/transcript", headers=headers).json()
        assert current["segments"][0]["speaker_id"] == chosen


def test_midstream_revisions_apply_in_order_without_changing_text(tmp_path: Path):
    app, sender, _ = _app(tmp_path)
    provider = FakeProvider()
    provider.stream = SpeakerStream([
        (final(0, "A"),),
        (StreamingSpeakerRevision(0, "B"), StreamingSpeakerRevision(0, None),
         final(1, "B", 900)),
    ])
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting = _create_realtime_meeting(client, token)
        with connect(client, meeting, token) as ws:
            ws.receive_json()
            ws.send_bytes(b"audio")
            first = ws.receive_json()
            assert client.patch(
                f"/api/v1/segments/{first['logical_segment_id']}", headers=headers,
                json={"text": "Edited text"},
            ).status_code == 200
            ws.send_bytes(b"audio")
            corrected, unassigned, second = (ws.receive_json() for _ in range(3))
            assert corrected["speaker_id"] == second["speaker_id"]
            assert unassigned["speaker_id"] is None
            ws.send_text('{"type":"recording.stop"}')
            assert ws.receive_json()["type"] == "meeting.status"
        current = client.get(f"/api/v1/meetings/{meeting}/transcript", headers=headers).json()
        assert current["segments"][0]["speaker_id"] is None
        assert current["segments"][0]["text"] == "Edited text"
        history = client.get(
            f"/api/v1/meetings/{meeting}/transcript/versions/{corrected['version_id']}",
            headers=headers,
        ).json()
        assert len(history["segments"]) == 1
        assert history["segments"][0]["speaker_id"] == corrected["speaker_id"]


def test_disabled_diarization_never_creates_speakers(tmp_path: Path):
    app, sender, _ = _app(tmp_path)
    provider = FakeProvider()
    provider.stream = SpeakerStream(
        [(final(0, "A"),)], (StreamingSpeakerRevision(0, "B"),)
    )
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting = _create_realtime_meeting(client, token)
        assert client.patch(
            f"/api/v1/meetings/{meeting}", headers=headers,
            json={"diarization_enabled": False},
        ).status_code == 200
        with connect(client, meeting, token) as ws:
            ws.receive_json()
            ws.send_bytes(b"audio")
            event = ws.receive_json()
            assert "speaker_id" not in event and "speaker_label" not in event
            ws.send_text('{"type":"recording.stop"}')
            assert ws.receive_json()["type"] == "meeting.status"
        assert client.get(f"/api/v1/meetings/{meeting}/speakers", headers=headers).json() == []


def test_realtime_rejects_unsupported_diarization(tmp_path: Path):
    class Provider(FakeProvider):
        def capabilities(self):
            return replace(super().capabilities(), diarization=False)

    app, sender, _ = _app(tmp_path)
    provider = Provider()
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        meeting = _create_realtime_meeting(client, session["access_token"])
        with connect(client, meeting, session["access_token"]) as ws:
            assert ws.receive_json()["code"] == "PROVIDER_CAPABILITY_UNAVAILABLE"
        assert provider.options is None


@pytest.mark.parametrize("operation", ["delete", "split", "merge"])
def test_revisions_preserve_structural_edits(tmp_path: Path, operation):
    app, sender, _ = _app(tmp_path)
    provider = FakeProvider()
    provider.stream = SpeakerStream(
        [(final(0, "A"), final(1, "A", 900))], (StreamingSpeakerRevision(0, "B"),)
    )
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting = _create_realtime_meeting(client, token)
        with connect(client, meeting, token) as ws:
            ws.receive_json()
            ws.send_bytes(b"audio")
            first, second = ws.receive_json(), ws.receive_json()
            logical_id = first["logical_segment_id"]
            if operation == "delete":
                result = client.delete(f"/api/v1/segments/{logical_id}", headers=headers)
            elif operation == "split":
                result = client.post(
                    f"/api/v1/segments/{logical_id}/split", headers=headers,
                    json={"split_at_ms": 450},
                )
            else:
                result = client.post(
                    "/api/v1/segments/merge", headers=headers,
                    json={"first_segment_id": logical_id,
                          "second_segment_id": second["logical_segment_id"]},
                )
            assert result.status_code == 200
            before = client.get(
                f"/api/v1/meetings/{meeting}/transcript", headers=headers,
            ).json()
            ws.send_text('{"type":"recording.stop"}')
            assert ws.receive_json()["type"] == "meeting.status"
        after = client.get(f"/api/v1/meetings/{meeting}/transcript", headers=headers).json()
        assert after == before


def test_new_recording_preserves_previous_session_snapshot(tmp_path: Path):
    app, sender, _ = _app(tmp_path)
    provider = FakeProvider()
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        token = session["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        meeting = _create_realtime_meeting(client, token)
        snapshots = []
        for _ in range(2):
            provider.stream = SpeakerStream([(final(0, "A"),)])
            with connect(client, meeting, token) as ws:
                ws.receive_json()
                ws.send_bytes(b"audio")
                assert ws.receive_json()["type"] == "transcript.final"
                ws.send_text('{"type":"recording.stop"}')
                assert ws.receive_json()["type"] == "meeting.status"
            snapshots.append(client.get(
                f"/api/v1/meetings/{meeting}/transcript", headers=headers,
            ).json())
        assert snapshots[0]["version_id"] != snapshots[1]["version_id"]
        assert len(snapshots[1]["segments"]) == 2
        old = client.get(
            f"/api/v1/meetings/{meeting}/transcript/versions/{snapshots[0]['version_id']}",
            headers=headers,
        ).json()
        assert old["segments"] == snapshots[0]["segments"]
