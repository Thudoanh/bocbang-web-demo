"""Authenticated meeting CRUD, collaborator ACL, and owner-managed share links."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.api.v1.routes.media import MediaServiceDependency
from app.api.v1.routes.exports import ExportServiceDependency
from app.core.dependencies import get_database
from app.db.session import Database
from app.schemas.meeting import (
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
)
from app.services.meetings import MeetingService

router = APIRouter(prefix="/meetings")


async def get_meeting_service(request: Request) -> AsyncIterator[MeetingService]:
    database: Database = get_database(request)
    async with database.session() as session:
        yield MeetingService(session)


MeetingServiceDependency = Annotated[MeetingService, Depends(get_meeting_service)]


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    payload: MeetingCreateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> MeetingResponse:
    return await service.create(user, payload)


@router.get("", response_model=list[MeetingResponse])
async def list_meetings(
    user: CurrentUserDependency, service: MeetingServiceDependency
) -> list[MeetingResponse]:
    return await service.list_for_user(user)


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(
    meeting_id: UUID, user: CurrentUserDependency, service: MeetingServiceDependency
) -> MeetingResponse:
    return await service.get(meeting_id, user)


@router.patch("/{meeting_id}", response_model=MeetingResponse)
async def update_meeting(
    meeting_id: UUID,
    payload: MeetingUpdateRequest,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
) -> MeetingResponse:
    return await service.update(meeting_id, user, payload)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: UUID,
    user: CurrentUserDependency,
    service: MeetingServiceDependency,
    media_service: MediaServiceDependency,
    export_service: ExportServiceDependency,
) -> Response:
    # Check ownership before touching storage, then let database cascades remove
    # media/job records after all associated object keys have been purged.
    await service.require_access(meeting_id, user, "owner")
    await media_service.purge_meeting_storage(meeting_id)
    await export_service.purge_meeting_storage(meeting_id)
    await service.delete(meeting_id, user)
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
