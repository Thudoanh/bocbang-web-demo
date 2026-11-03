"""Exports consume immutable revisions, including revisions stored only as events."""

import asyncio
import io
from pathlib import Path
from uuid import UUID

import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from test_exports_collaboration import _configure_export_worker
from test_transcripts import _app, _headers, _seed, _session

from app.models.transcript import SegmentVersion, TranscriptVersion
from app.providers.storage import LocalStorageBackend
from app.services.transcript_versions import TranscriptVersionReader


@pytest.fixture
def context(tmp_path: Path):
    app, sender, url = _app(tmp_path)
    app.state.media_storage = LocalStorageBackend(tmp_path / "objects")
    _configure_export_worker(app)
    with TestClient(app) as client:
        owner = _session(client, sender, "export-version@example.com")
        seeded = _seed(url, UUID(owner["user"]["id"]))
        yield app, client, _headers(owner), seeded, url, owner


def _export(client, headers, meeting_id, format="json"):
    response = client.post(
        f"/api/v1/meetings/{meeting_id}/exports", headers=headers, json={"format": format}
    )
    assert response.status_code == 202, response.text
    artifact = response.json()
    status = client.get(f"/api/v1/exports/{artifact['id']}", headers=headers).json()
    assert status["status"] == "completed", status
    download = client.get(f"/api/v1/exports/{artifact['id']}/download", headers=headers)
    assert download.status_code == 200
    assert "attachment" in download.headers["content-disposition"]
    return artifact, download


@pytest.mark.parametrize("format", ["txt", "json", "srt", "vtt", "pdf", "docx"])
def test_export_after_edit_all_formats(context, format):
    app, client, headers, seeded, _, _ = context
    edited_text = "Nội dung đã chỉnh sửa Việt Nam"
    edited = client.patch(
        f"/api/v1/segments/{seeded['first']}",
        headers=headers,
        json={"text": edited_text, "start_ms": 100},
    )
    assert edited.status_code == 200

    async def verify_event_only_revision():
        async with app.state.database.session() as session:
            rows = list(
                await session.scalars(
                    select(SegmentVersion).where(
                        SegmentVersion.transcript_version_id == UUID(edited.json()["version_id"])
                    )
                )
            )
            assert rows == []

    asyncio.run(verify_event_only_revision())
    artifact, download = _export(client, headers, seeded["meeting_id"], format)
    assert artifact["transcript_version_id"] == edited.json()["version_id"]
    if format == "docx":
        text = "\n".join(p.text for p in Document(io.BytesIO(download.content)).paragraphs)
        assert edited_text in text
    elif format == "pdf":
        assert download.content.startswith(b"%PDF-")
    else:
        assert edited_text in download.content.decode("utf-8")
        if format == "srt":
            assert "00:00:00,100 --> 00:00:01,000" in download.text
        elif format == "vtt":
            assert "00:00:00.100 --> 00:00:01.000" in download.text


def test_export_keeps_requested_revision_while_queued(context):
    app, client, headers, seeded, _, _ = context
    execute = app.state.enqueue_job
    queued = []
    app.state.enqueue_job = lambda job_id, settings: queued.append((job_id, settings))
    first = client.patch(
        f"/api/v1/segments/{seeded['first']}", headers=headers, json={"text": "Revision A"}
    )
    requested = client.post(
        f"/api/v1/meetings/{seeded['meeting_id']}/exports",
        headers=headers,
        json={"format": "json"},
    )
    assert requested.status_code == 202
    assert (
        client.get(
            f"/api/v1/exports/{requested.json()['id']}/download", headers=headers
        ).status_code
        == 409
    )
    assert (
        client.patch(
            f"/api/v1/segments/{seeded['first']}", headers=headers, json={"text": "Revision B"}
        ).status_code
        == 200
    )
    execute(*queued[0])
    download = client.get(f"/api/v1/exports/{requested.json()['id']}/download", headers=headers)
    assert download.status_code == 200
    assert download.json()["segments"][0]["text"] == "Revision A"
    assert download.json()["meeting"]["transcript_version_id"] == first.json()["version_id"]


def test_export_split_merge_speaker_and_delete(context):
    _, client, headers, seeded, _, _ = context
    split = client.post(
        f"/api/v1/segments/{seeded['first']}/split",
        headers=headers,
        json={"split_at_ms": 500, "first_text": "Alpha", "second_text": "Beta"},
    )
    assert split.status_code == 200
    _, download = _export(client, headers, seeded["meeting_id"])
    rows = download.json()["segments"]
    assert [(r["start_ms"], r["end_ms"]) for r in rows] == [(0, 500), (500, 1000), (1000, 2000)]
    assert rows[0]["speaker"] == "Provider speaker"
    speaker = client.post(
        f"/api/v1/meetings/{seeded['meeting_id']}/speakers",
        headers=headers,
        json={"name": "Edited speaker"},
    )
    assert speaker.status_code == 201
    merged = client.post(
        "/api/v1/segments/merge",
        headers=headers,
        json={"first_segment_id": rows[0]["id"], "second_segment_id": rows[1]["id"]},
    )
    assert merged.status_code == 200
    assert (
        client.patch(
            f"/api/v1/segments/{seeded['first']}/speaker",
            headers=headers,
            json={"speaker_id": speaker.json()["id"]},
        ).status_code
        == 200
    )
    assert client.delete(f"/api/v1/segments/{seeded['second']}", headers=headers).status_code == 200
    _, download = _export(client, headers, seeded["meeting_id"])
    rows = download.json()["segments"]
    assert len(rows) == 1
    assert rows[0]["text"] == "Alpha Beta"
    assert rows[0]["end_ms"] == 1000
    assert rows[0]["speaker"] == "Edited speaker"


def test_export_checkpoint_and_rollback(context):
    _, client, headers, seeded, _, _ = context
    for index in range(26):
        assert (
            client.patch(
                f"/api/v1/segments/{seeded['first']}",
                headers=headers,
                json={"text": f"Edit {index}"},
            ).status_code
            == 200
        )
        if index == 24:
            _, download = _export(client, headers, seeded["meeting_id"])
            assert download.json()["segments"][0]["text"] == "Edit 24"
    _, download = _export(client, headers, seeded["meeting_id"])
    assert download.json()["segments"][0]["text"] == "Edit 25"
    assert (
        client.post(
            f"/api/v1/meetings/{seeded['meeting_id']}/transcript/rollback",
            headers=headers,
            json={"target_version_id": seeded["version_id"]},
        ).status_code
        == 200
    )
    _, download = _export(client, headers, seeded["meeting_id"])
    assert download.json()["segments"][0]["text"] == "First segment"


def test_export_legacy_snapshot_without_checkpoint(context):
    app, client, headers, _, url, owner = context
    legacy = _seed(url, UUID(owner["user"]["id"]), projection=False)
    _, download = _export(client, headers, legacy["meeting_id"])
    assert download.json()["segments"][0]["text"] == "First segment"

    async def read_legacy():
        async with app.state.database.session() as session:
            version = await session.get(TranscriptVersion, UUID(legacy["version_id"]))
            assert version.checkpointed_at is None
            assert len(await TranscriptVersionReader(session).read(version)) == 2

    asyncio.run(read_legacy())


@pytest.mark.parametrize("missing_history", [False, True])
def test_export_invalid_input_fails_terminally(context, missing_history):
    app, client, headers, seeded, _, _ = context
    if missing_history:

        async def remove_checkpoint():
            async with app.state.database.session() as session:
                version = await session.get(TranscriptVersion, UUID(seeded["version_id"]))
                version.checkpointed_at = None
                await session.execute(
                    delete(SegmentVersion).where(SegmentVersion.transcript_version_id == version.id)
                )
                await session.commit()

        asyncio.run(remove_checkpoint())
    else:
        for logical_id in (seeded["first"], seeded["second"]):
            assert (
                client.delete(f"/api/v1/segments/{logical_id}", headers=headers).status_code == 200
            )
    response = client.post(
        f"/api/v1/meetings/{seeded['meeting_id']}/exports",
        headers=headers,
        json={"format": "json"},
    )
    assert response.status_code == 202
    job = client.get(f"/api/v1/jobs/{response.json()['job_id']}", headers=headers).json()
    assert job["status"] == "failed"
    assert job["error"]["retryable"] is False
    assert (
        client.get(f"/api/v1/exports/{response.json()['id']}/download", headers=headers).status_code
        == 409
    )
