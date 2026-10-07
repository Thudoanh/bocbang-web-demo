import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings
from app.db.base import Base
from app.main import create_app
from app.models.meeting import Meeting
from app.models.transcript import SegmentVersion, TranscriptVersion
from app.providers.contracts import (
    StreamingOptions,
    StreamingTranscriptionEvent,
    STTCapabilities,
    STTProviderError,
    TranscriptionSegment,
)


class CapturingEmailSender:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str, str]] = []

    async def send_otp(self, recipient: str, code: str, purpose: str) -> None:
        self.messages.append((recipient, code, purpose))


class FakeStream:
    def __init__(self, error: STTProviderError | None = None) -> None:
        self.error = error
        self.paused = False
        self.resumed = False
        self.closed = False

    async def send_audio(self, chunk: bytes) -> tuple[StreamingTranscriptionEvent, ...]:
        if self.error:
            raise self.error
        assert chunk == b"audio-chunk"
        return (
            StreamingTranscriptionEvent(
                type="partial",
                language="vi",
                segment=TranscriptionSegment(0, 800, "Bản nháp không được lưu"),
            ),
            StreamingTranscriptionEvent(
                type="final",
                language="vi",
                segment=TranscriptionSegment(
                    0, 900, "Bản cuối được lưu", speaker_label="speaker_1", confidence=0.97
                ),
            ),
        )

    async def pause(self) -> tuple[StreamingTranscriptionEvent, ...]:
        self.paused = True
        return ()

    async def resume(self) -> tuple[StreamingTranscriptionEvent, ...]:
        self.resumed = True
        return ()

    async def close(self) -> tuple[StreamingTranscriptionEvent, ...]:
        self.closed = True
        return ()


class FakeProvider:
    def __init__(self, *, streaming: bool = True, error: STTProviderError | None = None) -> None:
        self.streaming = streaming
        self.stream = FakeStream(error)
        self.options: StreamingOptions | None = None

    def capabilities(self) -> STTCapabilities:
        return STTCapabilities(
            batch=True,
            streaming=self.streaming,
            diarization=True,
            timestamps=True,
            confidence=True,
            supported_languages=frozenset({"vi", "en"}),
            multilingual_auto_detect=True,
        )

    async def transcribe_file(
        self, media_key: str, language: str | None = None
    ):  # pragma: no cover - protocol completeness
        raise NotImplementedError

    async def open_stream(self, options: StreamingOptions) -> FakeStream:
        self.options = options
        return self.stream


def test_realtime_persists_finals_but_never_partials_and_handles_pause_resume(tmp_path: Path) -> None:
    app, sender, database_url = _app(tmp_path)
    provider = FakeProvider()
    app.state.stt_provider = provider
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        meeting_id = _create_realtime_meeting(client, session["access_token"])
        with client.websocket_connect(
            f"/api/v1/realtime/{meeting_id}?access_token={session['access_token']}"
        ) as websocket:
            assert websocket.receive_json()["type"] == "session.ready"
            websocket.send_text('{"type":"recording.pause"}')
            websocket.send_text('{"type":"recording.resume"}')
            websocket.send_bytes(b"audio-chunk")
            assert websocket.receive_json()["type"] == "transcript.partial"
            final = websocket.receive_json()
            assert final["type"] == "transcript.final"
            assert final["text"] == "Bản cuối được lưu"
            websocket.send_text('{"type":"recording.stop"}')
            assert websocket.receive_json() == {"type": "meeting.status", "status": "processing"}

    async def verify() -> None:
        engine = create_async_engine(database_url)
        session_factory = async_sessionmaker(engine)
        async with session_factory() as session:
            versions = list(await session.scalars(select(TranscriptVersion)))
            segments = list(await session.scalars(select(SegmentVersion)))
            meeting = (await session.scalars(select(Meeting))).one()
        await engine.dispose()
        assert len(versions) == 1
        assert len(segments) == 1
        assert segments[0].text == "Bản cuối được lưu"
        assert meeting.status == "processing"

    asyncio.run(verify())
    assert provider.options is not None and provider.options.diarization is True
    assert provider.stream.paused and provider.stream.resumed and provider.stream.closed


def test_realtime_rejects_provider_without_streaming_capability(tmp_path: Path) -> None:
    app, sender, _ = _app(tmp_path)
    app.state.stt_provider = FakeProvider(streaming=False)
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        meeting_id = _create_realtime_meeting(client, session["access_token"])
        with client.websocket_connect(
            f"/api/v1/realtime/{meeting_id}?access_token={session['access_token']}"
        ) as websocket:
            error = websocket.receive_json()
            assert error["code"] == "PROVIDER_CAPABILITY_UNAVAILABLE"
            assert error["retryable"] is False
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_json()


def test_realtime_retryable_provider_error_closes_for_reconnect_without_failing_meeting(tmp_path: Path) -> None:
    app, sender, database_url = _app(tmp_path)
    app.state.stt_provider = FakeProvider(
        error=STTProviderError("Temporary streaming interruption.", retryable=True)
    )
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        meeting_id = _create_realtime_meeting(client, session["access_token"])
        with client.websocket_connect(
            f"/api/v1/realtime/{meeting_id}?access_token={session['access_token']}"
        ) as websocket:
            assert websocket.receive_json()["type"] == "session.ready"
            websocket.send_bytes(b"audio-chunk")
            error = websocket.receive_json()
            assert error["code"] == "STT_PROVIDER_ERROR"
            assert error["retryable"] is True
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == 1013

    async def verify() -> None:
        engine = create_async_engine(database_url)
        session_factory = async_sessionmaker(engine)
        async with session_factory() as session:
            meeting = (await session.scalars(select(Meeting))).one()
        await engine.dispose()
        assert meeting.status == "recording"

    asyncio.run(verify())

def test_realtime_non_retryable_provider_error_fails_meeting_not_completed(tmp_path: Path) -> None:
    app, sender, database_url = _app(tmp_path)
    app.state.stt_provider = FakeProvider(
        error=STTProviderError("Provider rejected the audio.", retryable=False)
    )
    with TestClient(app) as client:
        session = _verified_session(client, sender)
        meeting_id = _create_realtime_meeting(client, session["access_token"])
        with client.websocket_connect(
            f"/api/v1/realtime/{meeting_id}?access_token={session['access_token']}"
        ) as websocket:
            websocket.receive_json()
            websocket.send_bytes(b"audio-chunk")
            error = websocket.receive_json()
            assert error == {
                "type": "error",
                "code": "STT_PROVIDER_ERROR",
                "message": "Provider rejected the audio.",
                "retryable": False,
            }

    async def verify() -> None:
        engine = create_async_engine(database_url)
        session_factory = async_sessionmaker(engine)
        async with session_factory() as session:
            meeting = (await session.scalars(select(Meeting))).one()
        await engine.dispose()
        assert meeting.status == "failed"

    asyncio.run(verify())


def _app(tmp_path: Path) -> tuple[object, CapturingEmailSender, str]:
    database_url = f"sqlite+aiosqlite:///{(tmp_path / 'realtime.sqlite3').as_posix()}"

    async def create_schema() -> None:
        engine = create_async_engine(database_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(create_schema())
    app = create_app(
        Settings(
            _env_file=None,
            database_url=database_url,
            jwt_secret="test-secret",
            frontend_origins="http://localhost:5173",
            stt_provider="fake",
        )
    )
    sender = CapturingEmailSender()
    app.state.email_sender = sender
    return app, sender, database_url


def _verified_session(client: TestClient, sender: CapturingEmailSender) -> dict[str, object]:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "speaker@example.com", "password": "correct horse battery", "full_name": "Speaker"},
    )
    assert response.status_code == 201
    verified = client.post(
        "/api/v1/auth/verify-email-otp",
        json={"email": "speaker@example.com", "code": sender.messages[-1][1]},
    )
    assert verified.status_code == 200
    return verified.json()


def _create_realtime_meeting(client: TestClient, token: object) -> str:
    response = client.post(
        "/api/v1/meetings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": "Realtime test",
            "source_type": "realtime",
            "language_mode": "vi",
            "diarization_enabled": True,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]
