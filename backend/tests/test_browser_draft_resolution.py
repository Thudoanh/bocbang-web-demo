"""Interrupted Web Speech drafts can be resolved explicitly without fake STT finals."""
import asyncio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import Database
from app.models.transcript import CurrentSegment, TranscriptVersion
from test_browser_stt import _app, _verified_session, create_browser, ForbiddenCloudSTT


def setup_draft(client, app, sender):
    app.state.stt_provider = ForbiddenCloudSTT()
    app.state.translation_provider = None
    app.state.enqueue_job = lambda *_args: None
    token = _verified_session(client, sender)["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    mid = create_browser(client, token).json()["id"]
    ws_path = f"/api/v1/realtime/{mid}?access_token={token}"
    return token, headers, mid, ws_path


@pytest.mark.parametrize("action", ["confirm", "recover"])
def test_resolved_draft_records_its_source_and_survives_reload(tmp_path, action):
    app, sender, url = _app(tmp_path)
    with TestClient(app) as client:
        token, headers, mid, ws_path = setup_draft(client, app, sender)
        with client.websocket_connect(ws_path) as ws:
            ws.receive_json()
            ws.send_bytes(bytes(32_000))
            ws.send_json({"type":"transcript.browser", "result_id":"turn:0", "final":False,
                          "text":"Nháp chưa chốt", "start_ms":0, "end_ms":400, "revision":2,
                          "save_draft":True, "recognition_status":"unconfirmed"})
            draft = ws.receive_json()
            body = {"stream_segment_id":draft["stream_segment_id"], "revision":2, "action":action}
            path = f"/api/v1/meetings/{mid}/browser-drafts/resolve"
            assert client.post(path, headers=headers, json={**body,"revision":1}).status_code == 409
            assert client.post(path, json=body).status_code == 401
            # A later engine-confirmed turn already exists; recovery must insert
            # the missing earlier turn, not merge it with unrelated later text.
            ws.send_json({"type":"transcript.browser", "result_id":"turn:1", "final":True,
                          "text":"Nội dung tiếp theo", "start_ms":500, "end_ms":900, "revision":1})
            assert ws.receive_json()["type"] == "transcript.final"
            assert client.post(path, headers=headers, json=body).status_code == 200
            assert client.post(path, headers=headers, json=body).status_code == 200
            assert client.post(path, headers=headers, json={**body,"action":"discard"}).status_code == 409
            assert client.get(f"/api/v1/meetings/{mid}/browser-drafts", headers=headers).json() == []
            # A delayed/replayed engine result cannot recreate a resolved turn.
            ws.send_json({"type":"transcript.browser", "result_id":"turn:0", "final":True,
                          "text":"Đến quá muộn", "start_ms":0, "end_ms":400, "revision":3})
            ws.send_json({"type":"recording.pause", "acknowledge":True})
            assert ws.receive_json()["type"] == "recording.paused"
        response = client.get(f"/api/v1/meetings/{mid}/transcript", headers=headers)
        assert response.status_code == 200
        assert [s["text"] for s in response.json()["segments"]] == ["Nháp chưa chốt", "Nội dung tiếp theo"]
        assert all(s["speaker_id"] is None for s in response.json()["segments"])
        bundle = client.get(f"/api/v1/meetings/{mid}/bundle", headers=headers).json()
        assert bundle["browser_drafts"] == []

    async def verify_history():
        db = Database(url)
        try:
            async with db.session() as session:
                rows = list(await session.scalars(select(CurrentSegment).order_by(CurrentSegment.position)))
                assert len(rows) == 2
                assert rows[0].original_stt_text == ("Nháp chưa chốt" if action == "recover" else None)
                versions = list(await session.scalars(select(TranscriptVersion).order_by(TranscriptVersion.version_no)))
                assert [v.source.value for v in versions] == ["stt", "stt" if action == "recover" else "user_edit"]
                if action == "recover":
                    from app.models.transcript import TranscriptEditEvent
                    events = list(await session.scalars(select(TranscriptEditEvent)))
                    assert len(events) == 1 and events[0].event_type == "browser_auto_commit"
                    assert events[0].payload["engine_confirmed"] is False
                    assert events[0].payload["confirmation_source"] == "application"
        finally:
            await db.dispose()
    asyncio.run(verify_history())


@pytest.mark.parametrize("action", ["confirm", "discard", "recover"])
def test_first_draft_can_be_resolved_without_any_native_final(tmp_path, action):
    app, sender, _ = _app(tmp_path)
    with TestClient(app) as client:
        _, headers, mid, ws_path = setup_draft(client, app, sender)
        with client.websocket_connect(ws_path) as ws:
            ws.receive_json()
            ws.send_bytes(bytes(32_000))
            ws.send_json({"type":"transcript.browser", "result_id":"turn:0", "final":False,
                          "text":"Nội dung cần kiểm tra", "start_ms":0, "end_ms":500, "revision":1, "save_draft":True})
            draft = ws.receive_json()
            path = f"/api/v1/meetings/{mid}/browser-drafts/resolve"
            body = {"stream_segment_id":draft["stream_segment_id"], "revision":1, "action":action}
            assert client.post(path, headers=headers, json=body).status_code == 409  # active recognition
        # Connection interruption archives the acknowledged draft.
        assert client.post(path, headers=headers, json=body).status_code == 200
        assert client.post(path, headers=headers, json=body).status_code == 200
        assert client.get(f"/api/v1/meetings/{mid}/browser-drafts", headers=headers).json() == []
        if action in {"confirm", "recover"}:
            transcript = client.get(f"/api/v1/meetings/{mid}/transcript", headers=headers).json()
            assert [s["text"] for s in transcript["segments"]] == ["Nội dung cần kiểm tra"]


@pytest.mark.parametrize("action", ["discard", "recover"])
def test_other_account_cannot_resolve_draft(tmp_path, action):
    app, sender, _ = _app(tmp_path)
    with TestClient(app) as client:
        _, headers, mid, ws_path = setup_draft(client, app, sender)
        with client.websocket_connect(ws_path) as ws:
            ws.receive_json()
            ws.send_bytes(bytes(32_000))
            ws.send_json({"type":"transcript.browser", "result_id":"turn:0", "final":False,
                          "text":"Nháp riêng tư", "start_ms":0, "end_ms":500, "revision":1,
                          "save_draft":True, "recognition_status":"unconfirmed"})
            draft = ws.receive_json()
        assert client.post("/api/v1/auth/register", json={"email":"outsider@example.com",
            "password":"correct horse battery", "full_name":"Other account"}).status_code == 201
        outsider = client.post("/api/v1/auth/verify-email-otp", json={"email":"outsider@example.com",
            "code":sender.messages[-1][1]}).json()["access_token"]
        response = client.post(f"/api/v1/meetings/{mid}/browser-drafts/resolve",
            headers={"Authorization":f"Bearer {outsider}"}, json={"stream_segment_id":draft["stream_segment_id"],"revision":1,"action":action})
        assert response.status_code in {403,404}
        assert len(client.get(f"/api/v1/meetings/{mid}/browser-drafts", headers=headers).json()) == 1
