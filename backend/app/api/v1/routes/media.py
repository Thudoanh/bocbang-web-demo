"""Authenticated media upload/list/delete and durable job status endpoints."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.core.config import Settings
from app.core.dependencies import get_database, get_settings
from app.db.session import Database
from app.providers.storage import MediaStorage
from app.schemas.media import JobResponse, MediaFileResponse
from app.services.media import MediaService

meetings_router = APIRouter(prefix="/meetings")
jobs_router = APIRouter(prefix="/jobs")


async def get_media_service(request: Request) -> AsyncIterator[MediaService]:
    database: Database = get_database(request)
    settings: Settings = get_settings(request)
    storage = cast(MediaStorage, request.app.state.media_storage)
    async with database.session() as session:
        yield MediaService(session, settings, storage)


MediaServiceDependency = Annotated[MediaService, Depends(get_media_service)]


@meetings_router.post(
    "/{meeting_id}/media", response_model=JobResponse, status_code=status.HTTP_201_CREATED
)
async def upload_media(
    meeting_id: UUID,
    file: Annotated[UploadFile, File(...)],
    user: CurrentUserDependency,
    service: MediaServiceDependency,
) -> JobResponse:
    return await service.upload(meeting_id, user, file)


@meetings_router.get("/{meeting_id}/media", response_model=list[MediaFileResponse])
async def list_media(
    meeting_id: UUID, user: CurrentUserDependency, service: MediaServiceDependency
) -> list[MediaFileResponse]:
    return await service.list_media(meeting_id, user)


@meetings_router.delete("/{meeting_id}/media/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    meeting_id: UUID,
    media_id: UUID,
    user: CurrentUserDependency,
    service: MediaServiceDependency,
) -> Response:
    await service.delete_media(meeting_id, media_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@jobs_router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID, user: CurrentUserDependency, service: MediaServiceDependency
) -> JobResponse:
    return await service.get_job(job_id, user)
