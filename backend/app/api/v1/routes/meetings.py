"""Authenticated meeting CRUD, collaborator ACL, and owner-managed share links."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID
from sqlalchemy import select

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.api.v1.routes.media import MediaServiceDependency
from app.api.v1.routes.exports import ExportServiceDependency
from app.core.dependencies import DatabaseSessionDependency
from app.schemas.transcript import TranscriptResponse
from app.api.v1.routes.transcripts import TranscriptServiceDependency
from app.api.v1.routes.ai import AIServiceDependency
from app.schemas.meeting import (
    MeetingBundleResponse,
    MeetingCreateRequest,
    MeetingMemberCreateRequest,
    MeetingMemberResponse,
    MeetingMemberUpdateRequest,
    MeetingResponse,
    MeetingUpdateRequest,
    ShareLinkCreateRequest,
    ShareLinkCreatedResponse,
    ShareLinkResponse,
    ShareLinkUpdateRequest,
    LiveShareResponse,
)
from app.models.enums import MeetingSourceType, MeetingStatus
from app.services.meetings import MeetingService, register_bundle_invalidator
from app.services.browser_drafts import BrowserDraftService
from app.schemas.browser_draft import BrowserDraftResponse, BrowserDraftResolveRequest
import time

_BUNDLE_CACHE: dict[UUID, tuple[float, MeetingBundleResponse]] = {}
_BUNDLE_CACHE_TTL = 15.0

def invalidate_bundle_cache(meeting_id: UUID | None = None) -> None:
    if meeting_id is None:
        _BUNDLE_CACHE.clear()
    else:
        _BUNDLE_CACHE.pop(meeting_id, None)

register_bundle_invalidator(invalidate_bundle_cache)

from app.schemas.meeting_section import (
    MeetingSectionResponse,
    SectionCreateRequest,
    SectionUpdateRequest,
)
from app.services.meeting_sections import MeetingSectionService

router = APIRouter(prefix="/meetings")


async def get_meeting_service(session: DatabaseSessionDependency) -> MeetingService:
    return MeetingService(session)


MeetingServiceDependency = Annotated[MeetingService, Depends(get_meeting_service)]

@router.get("/{meeting_id}/sections", response_model=list[MeetingSectionResponse])
async def list_sections(meeting_id: UUID, user: CurrentUserDependency, session: DatabaseSessionDependency):
    return await MeetingSectionService(session).list(meeting_id, user)


@router.patch("/{meeting_id}/sections/{section_id}", response_model=MeetingSectionResponse)
async def rename_section(meeting_id: UUID, section_id: UUID, body: SectionUpdateRequest,
                         user: CurrentUserDependency, session: DatabaseSessionDependency):
    return await MeetingSectionService(session).update(meeting_id, section_id, user, body)


@router.post("/{meeting_id}/sections", response_model=list[MeetingSectionResponse], status_code=201)
async def create_section(meeting_id: UUID, body: SectionCreateRequest,
                         user: CurrentUserDependency, session: DatabaseSessionDependency):
    return await MeetingSectionService(session).create(meeting_id, user, body)


@router.delete("/{meeting_id}/sections/{section_id}", response_model=list[MeetingSectionResponse])
async def delete_section(meeting_id: UUID, section_id: UUID, user: CurrentUserDependency,
                         session: DatabaseSessionDependency, expected_revision: str = Query(max_length=64)):
    return await MeetingSectionService(session).delete(meeting_id, section_id, user, expected_revision)



@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    payload: MeetingCreateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> MeetingResponse:
    return await service.create(user, payload)


@router.get("", response_model=list[MeetingResponse])
async def list_meetings(
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, min_length=1, max_length=255),
    status: MeetingStatus | None = Query(default=None),
    source_type: MeetingSourceType | None = Query(default=None),
) -> list[MeetingResponse]:
    return await service.list_for_user(user, limit=limit, offset=offset, query_text=q, status=status, source_type=source_type)


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(
    meeting_id: UUID, user: CurrentUserDependency, service: MeetingServiceDependency
) -> MeetingResponse:
    return await service.get(meeting_id, user)


@router.get("/{meeting_id}/bundle", response_model=MeetingBundleResponse)
async def get_meeting_bundle(
    meeting_id: UUID,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
    transcript_service: TranscriptServiceDependency,
    media_service: MediaServiceDependency,
    ai_service: AIServiceDependency,
    request: Request,
) -> MeetingBundleResponse:
    now = time.monotonic()
    force_fresh = request.query_params.get("force_fresh") in ("1", "true")
    cached = _BUNDLE_CACHE.get(meeting_id)
    if not force_fresh and cached is not None and cached[1].meeting.stt_mode != "browser" and (now - cached[0]) < _BUNDLE_CACHE_TTL:
        await service.require_access(meeting_id, user, "read")
        return cached[1]

    meeting, permission = await service.require_access(meeting_id, user, "read")
    meeting_res = service._meeting_response(meeting, permission)

    try:
        transcript_res = await transcript_service.current(meeting_id, user, limit=2000)
    except Exception:
        transcript_res = None

    try:
        media_res = await media_service.list_media(meeting_id, user)
    except Exception:
        media_res = []

    try:
        speakers_res = await transcript_service.list_speakers(meeting_id, user)
    except Exception:
        speakers_res = []

    try:
        translations_res = await ai_service.list_translations(meeting_id, user)
    except Exception:
        translations_res = []

    # Merge or populate translations from meeting_broadcaster if any live translations exist
    from app.services.broadcaster import meeting_broadcaster
    live_trans = meeting_broadcaster.get_translations(meeting_id)
    if live_trans and meeting.current_transcript_version_id:
        from datetime import datetime, UTC
        from app.schemas.ai import TranslationResponse, TranslationSegmentResponse
        if not translations_res:
            seg_responses = []
            for idx, (seg_id_str, txt) in enumerate(live_trans.items(), start=1):
                try:
                    seg_uuid = UUID(seg_id_str)
                    seg_responses.append(TranslationSegmentResponse(
                        logical_segment_id=seg_uuid,
                        sequence=idx,
                        text=txt,
                    ))
                except ValueError:
                    pass
            if seg_responses:
                translations_res = [
                    TranslationResponse(
                        id=meeting_id,
                        meeting_id=meeting_id,
                        transcript_version_id=meeting.current_transcript_version_id,
                        source_language=meeting.language_mode if meeting.language_mode != "auto" else "vi",
                        target_language="en",
                        created_at=datetime.now(UTC),
                        segments=seg_responses,
                    )
                ]
        else:
            existing_ids = {s.logical_segment_id for t in translations_res for s in (t.segments or [])}
            extra_segs = []
            for idx, (seg_id_str, txt) in enumerate(live_trans.items(), start=len(existing_ids) + 1):
                try:
                    seg_uuid = UUID(seg_id_str)
                    if seg_uuid not in existing_ids:
                        extra_segs.append(TranslationSegmentResponse(
                            logical_segment_id=seg_uuid,
                            sequence=idx,
                            text=txt,
                        ))
                except ValueError:
                    pass
            if extra_segs and translations_res[0].segments is not None:
                translations_res[0].segments.extend(extra_segs)

    bundle = MeetingBundleResponse(
        browser_drafts=await BrowserDraftService(service._session).list(meeting_id) if meeting.stt_mode == "browser" else [],
        meeting=meeting_res,
        transcript=transcript_res,
        media=media_res,
        speakers=speakers_res,
        translations=translations_res,
    )
    if meeting.stt_mode != "browser" and meeting.status != MeetingStatus.PROCESSING and transcript_res is not None and getattr(transcript_res, "segments", None):
        _BUNDLE_CACHE[meeting_id] = (now, bundle)
    else:
        _BUNDLE_CACHE.pop(meeting_id, None)
    return bundle


@router.get("/{meeting_id}/browser-drafts", response_model=list[BrowserDraftResponse])
async def get_browser_drafts(meeting_id: UUID, user: CurrentUserDependency,
                             service: MeetingServiceDependency) -> list[BrowserDraftResponse]:
    await service.require_access(meeting_id, user, "read")
    return await BrowserDraftService(service._session).list(meeting_id)


@router.post("/{meeting_id}/browser-drafts/resolve")
async def resolve_browser_draft(meeting_id: UUID, body: BrowserDraftResolveRequest,
                                user: CurrentUserDependency, service: MeetingServiceDependency):
    from app.services.broadcaster import meeting_broadcaster
    row, segment = await BrowserDraftService(service._session).resolve(meeting_id, user, body)
    payload = {"type": "transcript.partial", "language": row.language,
               "stream_segment_id": row.stream_segment_id, "text": "", "recognition_status": "withdrawn",
               "revision": row.revision + 1, "start_ms": row.start_ms, "end_ms": row.end_ms}
    if segment is not None:
        payload.update(type="transcript.final", text=segment.text,
                       logical_segment_id=str(segment.logical_segment_id), recognition_status=None)
    await meeting_broadcaster.broadcast(meeting_id, payload)
    invalidate_bundle_cache(meeting_id)
    return {"stream_segment_id": row.stream_segment_id, "action": body.action,
            "logical_segment_id": str(segment.logical_segment_id) if segment is not None else None}


@router.patch("/{meeting_id}", response_model=MeetingResponse)
async def update_meeting(
    meeting_id: UUID,
    payload: MeetingUpdateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> MeetingResponse:
    return await service.update(meeting_id, user, payload)


@router.post("/{meeting_id}/complete", response_model=MeetingResponse)
async def complete_meeting(
    meeting_id: UUID, user: CurrentUserDependency, request: Request,
) -> MeetingResponse:
    from app.core.dependencies import get_database
    from app.services.transcript_polish import complete_with_polish
    from app.api.v1.routes.realtime import _persist_live_translations
    async with get_database(request).session() as session:
        try:
            await _persist_live_translations(session, meeting_id, "en")
        except Exception:
            pass
        return await complete_with_polish(session, meeting_id, user, request.app.state)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: UUID,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
    media_service: MediaServiceDependency,
    export_service: ExportServiceDependency,
) -> Response:
    meeting, _ = await service.require_access(meeting_id, user, "owner")
    await media_service.purge_meeting_storage(meeting_id)
    await export_service.purge_meeting_storage(meeting_id)
    await service.delete(meeting_id, user, meeting=meeting)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{meeting_id}/members", response_model=list[MeetingMemberResponse])
async def list_members(
    meeting_id: UUID, user: CurrentUserDependency, service: MeetingServiceDependency
) -> list[dict[str, object]]:
    return await service.list_members(meeting_id, user)


@router.post(
    "/{meeting_id}/members",
    response_model=MeetingMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    meeting_id: UUID,
    payload: MeetingMemberCreateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> dict[str, object]:
    return await service.add_member(meeting_id, user, payload)


@router.patch("/{meeting_id}/members/{user_id}", response_model=MeetingMemberResponse)
async def update_member(
    meeting_id: UUID,
    user_id: UUID,
    payload: MeetingMemberUpdateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> dict[str, object]:
    return await service.update_member(meeting_id, user, user_id, payload.permission)


@router.delete("/{meeting_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    meeting_id: UUID,
    user_id: UUID,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> Response:
    await service.remove_member(meeting_id, user, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{meeting_id}/shares",
    response_model=ShareLinkCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_share(
    meeting_id: UUID,
    payload: ShareLinkCreateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> ShareLinkCreatedResponse:
    return await service.create_share(meeting_id, user, payload)


@router.get("/{meeting_id}/shares", response_model=list[ShareLinkResponse])
async def list_shares(
    meeting_id: UUID, user: CurrentUserDependency, service: MeetingServiceDependency
) -> list[ShareLinkResponse]:
    return await service.list_shares(meeting_id, user)


@router.patch("/shares/{share_id}", response_model=ShareLinkResponse)
async def update_share(
    share_id: UUID,
    payload: ShareLinkUpdateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> ShareLinkResponse:
    return await service.update_share(share_id, user, payload)


@router.delete("/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    share_id: UUID, user: CurrentUserDependency, service: MeetingServiceDependency
) -> Response:
    await service.revoke_share(share_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{meeting_id}/live-share", response_model=LiveShareResponse)
@router.get("/{meeting_id}/live-share", response_model=LiveShareResponse)
async def get_or_create_live_share(
    meeting_id: UUID,
    request: Request,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> LiveShareResponse:
    settings = request.app.state.settings
    return await service.get_or_create_live_share(meeting_id, user, settings.jwt_secret)
