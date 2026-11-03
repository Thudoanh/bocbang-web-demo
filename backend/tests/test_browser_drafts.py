from fastapi.testclient import TestClient

from test_browser_stt import ForbiddenCloudSTT, create_browser
from test_realtime import FakeTranslation, _app, _verified_session


def test_browser_finals_merged_in_place_broadcast_and_translate_the_whole_row(tmp_path):
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = ForbiddenCloudSTT()
    app.state.translation_provider = FakeTranslation()
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        mid = create_browser(client, token).json()["id"]
        with client.websocket_connect(f"/api/v1/realtime/{mid}?access_token={token}") as ws:
            ws.receive_json()
            ws.send_json({"type": "translation.enable", "target_language": "en", "logical_segment_ids": []})
            assert ws.receive_json()["type"] == "translation.status"
            ws.send_bytes(bytes(128_000))
            finals = []
            for turn, text in enumerate(["Xin chào.", "Mọi người."]):
                message = {"type": "transcript.browser", "result_id": f"turn:{turn}",
                    "text": text, "start_ms": turn * 1200, "end_ms": turn * 1200 + 1000,
                    "revision": 1, "final": False, "save_draft": True}
                ws.send_json(message)
                assert ws.receive_json()["type"] == "transcript.partial"
                ws.send_json({**message, "revision": 2, "final": True, "save_draft": False})
                event = ws.receive_json()
                while event["type"] == "translation.partial":
                    event = ws.receive_json()
                assert event["type"] == "transcript.final"
                finals.append(event)
                translated = ws.receive_json()
                while translated["type"] == "translation.partial":
                    translated = ws.receive_json()
                assert translated["type"] == "translation.final"
                assert translated["text"] == f"Translated: {event['text']}"
                assert client.get(f"/api/v1/meetings/{mid}/browser-drafts", headers=headers).json() == []
            rows = client.get(f"/api/v1/meetings/{mid}/transcript", headers=headers).json()["segments"]
            assert len(rows) == 1
            assert finals[0]["logical_segment_id"] == finals[1]["logical_segment_id"]
            assert finals[0]["stream_segment_id"] != finals[1]["stream_segment_id"]
            assert rows[0]["text"] == finals[1]["text"]
            assert "xin chào" in rows[0]["text"].lower() and "mọi người" in rows[0]["text"].lower()


def test_continuous_speech_upserts_one_draft_restores_and_final_replaces_it(tmp_path):
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = ForbiddenCloudSTT()
    app.state.enqueue_job = lambda *args: None
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        mid = create_browser(client, token).json()["id"]
        share = client.post(f"/api/v1/meetings/{mid}/shares", headers=headers, json={"permission": "read"})
        assert share.status_code == 201
        share_token = share.json()["token"]
        path = f"/api/v1/meetings/{mid}/browser-drafts"
        assert client.get(path).status_code == 401
        with client.websocket_connect(f"/api/v1/realtime/{mid}?access_token={token}") as ws:
            ready = ws.receive_json()
            assert ready["stream_session_id"]
            # Two minutes of continuously revised text: no silence or native final.
            for revision in range(1, 61):
                ws.send_bytes(bytes(64_000))
                message = {"type": "transcript.browser", "result_id": "turn:0", "final": False,
                    "text": " ".join(f"từ{i}" for i in range(revision)), "start_ms": 0,
                    "end_ms": revision * 2000, "revision": revision, "save_draft": True}
                ws.send_json(message)
                event = ws.receive_json()
                assert event["type"] == "transcript.partial"
                assert event["draft_saved_revision"] == revision
            drafts = client.get(path, headers=headers).json()
            assert len(drafts) == 1 and drafts[0]["text"] == message["text"]
            assert drafts[0]["revision"] == 60
            bundle = client.get(f"/api/v1/meetings/{mid}/bundle", headers=headers).json()
            assert bundle["transcript"] is None
            assert bundle["browser_drafts"] == drafts
            shared = client.get(f"/api/v1/shares/{share_token}/transcript").json()
            assert shared["transcript"] is None and shared["browser_drafts"] == drafts
            with client.websocket_connect(f"/api/v1/realtime/shares/{share_token}") as viewer:
                assert viewer.receive_json()["type"] == "session.ready"
                assert viewer.receive_json()["drafts"][0]["text"] == message["text"]
            # A stale revision must not overwrite acknowledged newer words.
            ws.send_json({**message, "revision": 1, "text": "Cũ"})
            ws.send_json({"type": "recording.pause", "acknowledge": True})
            assert ws.receive_json()["type"] == "recording.paused"
            assert client.get(path, headers=headers).json()[0]["revision"] == 60
            ws.send_json({"type": "recording.resume", "acknowledge": True})
            assert ws.receive_json()["type"] == "recording.resumed"
            final = {**message, "revision": 61, "save_draft": False, "final": True, "text": "Bản cuối sửa lại cả những từ đầu."}
            ws.send_json(final)
            stored = ws.receive_json()
            assert stored["type"] == "transcript.final"
            assert stored["stream_segment_id"] == drafts[0]["stream_segment_id"]
            assert client.get(path, headers=headers).json() == []
            bundle = client.get(f"/api/v1/meetings/{mid}/bundle", headers=headers).json()
            assert bundle["browser_drafts"] == []
            assert [row["text"] for row in bundle["transcript"]["segments"]] == [final["text"]]
            ws.send_json(final)
            ws.send_json({"type": "recording.stop"})
            assert ws.receive_json()["type"] == "meeting.status"
        assert len(client.get(f"/api/v1/meetings/{mid}/transcript", headers=headers).json()["segments"]) == 1


def test_saved_draft_survives_disconnect_and_withdrawal_is_scoped(tmp_path):
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = ForbiddenCloudSTT()
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        mid = create_browser(client, token).json()["id"]
        url = f"/api/v1/realtime/{mid}?access_token={token}"
        with client.websocket_connect(url) as ws:
            ws.receive_json()
            ws.send_bytes(bytes(32_000))
            message = {"type": "transcript.browser", "result_id": "turn:0", "final": False,
                "text": "Chưa có bản cuối", "start_ms": 0, "end_ms": 1000, "revision": 1, "save_draft": True}
            ws.send_json(message)
            saved = ws.receive_json()
        restored = client.get(f"/api/v1/meetings/{mid}/bundle", headers=headers).json()
        assert restored["browser_drafts"][0]["text"] == message["text"]
        assert restored["meeting"]["status"] == "recording"
        with client.websocket_connect(url) as ws:
            ws.receive_json()
            assert ws.receive_json()["drafts"][0]["text"] == message["text"]
            ws.send_bytes(bytes(32_000))
            ws.send_json(message)
            new = ws.receive_json()
            assert new["stream_segment_id"] != saved["stream_segment_id"]
            ws.send_json({**message, "text": "", "recognition_status": "withdrawn", "revision": 2})
            assert ws.receive_json()["text"] == ""
            remaining = client.get(f"/api/v1/meetings/{mid}/browser-drafts", headers=headers).json()
            assert [row["stream_segment_id"] for row in remaining] == [saved["stream_segment_id"]]


def test_failed_final_does_not_delete_the_recoverable_draft(tmp_path, monkeypatch):
    from app.services.transcripts import TranscriptService
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = ForbiddenCloudSTT()
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        mid = create_browser(client, token).json()["id"]
        with client.websocket_connect(f"/api/v1/realtime/{mid}?access_token={token}") as ws:
            ws.receive_json()
            ws.send_bytes(bytes(32_000))
            message = {"type": "transcript.browser", "result_id": "turn:0", "final": False,
                "text": "Cần khôi phục", "start_ms": 0, "end_ms": 1000, "revision": 1, "save_draft": True}
            ws.send_json(message)
            ws.receive_json()
            async def fail(*args, **kwargs):
                raise ValueError("Simulated persistence failure")
            monkeypatch.setattr(TranscriptService, "append_stt_final", fail)
            ws.send_json({**message, "final": True, "save_draft": False, "revision": 2})
            assert ws.receive_json()["type"] == "error"
            drafts = client.get(f"/api/v1/meetings/{mid}/browser-drafts", headers=headers).json()
            assert len(drafts) == 1 and drafts[0]["text"] == message["text"]


def test_guest_is_notified_when_owner_disconnects_even_before_first_autosave(tmp_path):
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = ForbiddenCloudSTT()
    with TestClient(app) as client:
        token = _verified_session(client, sender)["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        mid = create_browser(client, token).json()["id"]
        shared = client.post(f"/api/v1/meetings/{mid}/shares", headers=headers, json={"permission": "read"}).json()
        with client.websocket_connect(f"/api/v1/realtime/shares/{shared['token']}") as viewer:
            viewer.receive_json()
            with client.websocket_connect(f"/api/v1/realtime/{mid}?access_token={token}") as owner:
                ready = owner.receive_json()
                owner.send_bytes(bytes(32000))
                owner.send_json({"type": "transcript.browser", "result_id": "turn:0", "final": False,
                    "text": "Chưa tới lần tự lưu", "start_ms": 0, "end_ms": 1000, "revision": 1})
                assert owner.receive_json()["type"] == "transcript.partial"
                assert viewer.receive_json()["type"] == "transcript.partial"
            interrupted = viewer.receive_json()
            assert interrupted == {"type": "transcript.interrupted", "stream_session_id": ready["stream_session_id"]}
