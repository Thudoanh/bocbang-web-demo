"""Authenticated realtime STT WebSocket endpoint."""

from __future__ import annotations

import json
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import TokenService
from app.db.session import Database
from app.models.enums import MeetingPermission
from app.models.user import User
from app.providers.contracts import (
    StreamingOptions,
    StreamingTranscriptionEvent,
    STTProvider,
    STTProviderError,
    STTStream,
)
from app.services.meetings import MeetingService
from app.services.realtime import RealtimeTranscriptService

router = APIRouter()


@router.websocket("/realtime/{meeting_id}")
async def realtime_transcription(websocket: WebSocket, meeting_id: UUID) -> None:
    """Accept binary audio and emit normalized partial/final transcript events."""
    await websocket.accept()
    stream: STTStream | None = None
    transcript_service: RealtimeTranscriptService | None = None
    terminal_failure = False
    retryable_interruption = False
    try:
        settings = cast(Settings, websocket.app.state.settings)
        provider = cast(STTProvider | None, getattr(websocket.app.state, "stt_provider", None))
        if provider is None:
            await _error_and_close(
                websocket,
                "PROVIDER_CAPABILITY_UNAVAILABLE",
                "Realtime transcription is not configured.",
                retryable=False,
            )
            return
        if not provider.capabilities().streaming:
            await _error_and_close(
                websocket,
                "PROVIDER_CAPABILITY_UNAVAILABLE",
                "The configured STT provider does not support streaming.",
                retryable=False,
            )
            return
        user = await _websocket_user(websocket, settings)
        database = cast(Database, websocket.app.state.database)
        async with database.session() as session:
            meeting, _ = await MeetingService(session).require_access(
                meeting_id, user, MeetingPermission.EDIT
            )
            options = StreamingOptions(
                language=meeting.language_mode,
                diarization=meeting.diarization_enabled,
            )
            try:
                stream = await provider.open_stream(options)
            except STTProviderError as exc:
                if not exc.retryable:
                    await RealtimeTranscriptService(session, meeting, user.id).recording_failed()
                await _handle_provider_error(websocket, exc)
                return
            except Exception:
                await _handle_provider_error(
                    websocket,
                    STTProviderError("The STT provider could not start a realtime session."),
                )
                return
            transcript_service = RealtimeTranscriptService(session, meeting, user.id)
            await transcript_service.recording_started()
            await websocket.send_json(
                {
                    "type": "session.ready",
                    "provider": settings.stt_provider or provider.__class__.__name__,
                    "language": meeting.language_mode,
                }
            )
            paused = False
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    if paused:
                        await _send_error(
                            websocket, "SESSION_PAUSED", "Resume recording before sending audio.", False
                        )
                        continue
                    try:
                        events = await stream.send_audio(message["bytes"])
                        await _emit_events(websocket, transcript_service, events)
                    except STTProviderError as exc:
                        terminal_failure = not exc.retryable
                        retryable_interruption = exc.retryable
                        if terminal_failure:
                            await transcript_service.recording_failed()
                        await _handle_provider_error(websocket, exc)
                        return
                    except ValueError as exc:
                        await _send_error(websocket, "STT_RESULT_INVALID", str(exc), False)
                    except Exception:
                        retryable_interruption = True
                        await _handle_provider_error(
                            websocket,
                            STTProviderError("The STT provider could not process this audio chunk."),
                        )
                        return
                    continue
                if message.get("text") is None:
                    await _send_error(websocket, "INVALID_MESSAGE", "Audio chunks must be binary.", False)
                    continue
                command = _command(message["text"])
                if command is None:
                    await _send_error(websocket, "INVALID_MESSAGE", "Realtime command is invalid.", False)
                    continue
                try:
                    if command == "recording.pause":
                        paused = True
                        await _emit_events(websocket, transcript_service, await stream.pause())
                    elif command == "recording.resume":
                        paused = False
                        await _emit_events(websocket, transcript_service, await stream.resume())
                    else:  # recording.stop
                        await _emit_events(websocket, transcript_service, await stream.close())
                        stream = None
                        await transcript_service.recording_ended()
                        await websocket.send_json({"type": "meeting.status", "status": "processing"})
                        await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                        return
                except STTProviderError as exc:
                    terminal_failure = not exc.retryable
                    retryable_interruption = exc.retryable
                    if terminal_failure:
                        await transcript_service.recording_failed()
                    await _handle_provider_error(websocket, exc)
                    return
                except ValueError as exc:
                    await _send_error(websocket, "STT_RESULT_INVALID", str(exc), False)
                except Exception:
                    retryable_interruption = True
                    await _handle_provider_error(
                        websocket,
                        STTProviderError("The STT provider could not process this realtime command."),
                    )
                    return
    except WebSocketDisconnect:
        pass
    except ApiError as exc:
        await _error_and_close(websocket, exc.code, exc.message, retryable=False)
    except Exception:
        await _error_and_close(
            websocket, "INTERNAL_SERVER_ERROR", "Realtime transcription could not continue.", False
        )
    finally:
        if stream is not None:
            try:
                events = await stream.close()
                if transcript_service is not None:
                    await _emit_events(websocket, transcript_service, events, send_client=False)
            except (STTProviderError, RuntimeError, ValueError):
                pass
        if transcript_service is not None and not terminal_failure and not retryable_interruption:
            try:
                await transcript_service.recording_ended()
            except RuntimeError:
                pass


async def _websocket_user(websocket: WebSocket, settings: Settings) -> User:
    token = websocket.query_params.get("access_token")
    if not token:
        raise ApiError("AUTH_REQUIRED", "Authentication is required.", 401)
    user_id = TokenService(
        settings.jwt_secret, settings.access_token_ttl_seconds, settings.refresh_token_ttl_seconds
    ).verify(token, "access")
    database = cast(Database, websocket.app.state.database)
    async with database.session() as session:
        user = await session.get(User, user_id)
        if user is None or not user.is_email_verified:
            raise ApiError("AUTH_REQUIRED", "Authentication is required.", 401)
        # The session used for access/persistence must own the object instance.
        return User(id=user.id, email=user.email, full_name=user.full_name, is_email_verified=True)


def _command(raw_message: str) -> str | None:
    try:
        payload: Any = json.loads(raw_message)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or payload.get("type") not in {
        "recording.pause",
        "recording.resume",
        "recording.stop",
    }:
        return None
    return cast(str, payload["type"])


async def _emit_events(
    websocket: WebSocket,
    transcript_service: RealtimeTranscriptService,
    events: tuple[StreamingTranscriptionEvent, ...],
    *,
    send_client: bool = True,
) -> None:
    for event in events:
        segment = event.segment
        payload = {
            "type": f"transcript.{event.type}",
            "language": event.language,
            "start_ms": segment.start_ms,
            "end_ms": segment.end_ms,
            "text": segment.text,
            "speaker_label": segment.speaker_label,
            "confidence": segment.confidence,
        }
        if event.type == "final":
            stored = await transcript_service.persist_final(segment)
            payload["logical_segment_id"] = str(stored.logical_segment_id)
        if send_client:
            await websocket.send_json({key: value for key, value in payload.items() if value is not None})


async def _send_error(websocket: WebSocket, code: str, message: str, retryable: bool) -> None:
    await websocket.send_json(
        {"type": "error", "code": code, "message": message, "retryable": retryable}
    )


async def _error_and_close(
    websocket: WebSocket, code: str, message: str, retryable: bool
) -> None:
    await _send_error(websocket, code, message, retryable)
    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)


async def _handle_provider_error(websocket: WebSocket, error: STTProviderError) -> None:
    await _send_error(websocket, error.code, str(error), error.retryable)
    await websocket.close(
        code=1013 if error.retryable else status.WS_1011_INTERNAL_ERROR,
        reason=error.code,
    )
