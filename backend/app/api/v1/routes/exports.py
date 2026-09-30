"""ACL-protected export request, status, and download routes."""

from collections.abc import AsyncIterator
from typing import Annotated, cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.core.dependencies import get_database
from app.db.session import Database
from app.providers.storage import MediaStorage
from app.schemas.export import ExportCreateRequest, ExportResponse
from app.services.ai import AIJobDispatcher
from app.services.exports import ExportService

meetings_router = APIRouter(prefix="/meetings")
exports_router = APIRouter(prefix="/exports")


async def get_export_service(request: Request) -> AsyncIterator[ExportService]:
    database: Database = get_database(request)
    async with database.session() as session:
        yield ExportService(session, cast(MediaStorage, request.app.state.media_storage))


ExportServiceDependency = Annotated[ExportService, Depends(get_export_service)]


@meetings_router.post(
    "/{meeting_id}/exports", response_model=ExportResponse, status_code=status.HTTP_202_ACCEPTED
)
async def create_export(
    meeting_id: UUID,
    payload: ExportCreateRequest,
    user: CurrentUserDependency,
    service: ExportServiceDependency,
    request: Request,
) -> ExportResponse:
    export = await service.request(meeting_id, user, payload)
    cast(AIJobDispatcher, request.app.state.ai_job_dispatcher).enqueue(export.job_id)
    return export


@exports_router.get("/{export_id}", response_model=ExportResponse)
async def get_export(
    export_id: UUID, user: CurrentUserDependency, service: ExportServiceDependency
) -> ExportResponse:
    return await service.get(export_id, user)


@exports_router.get("/{export_id}/download")
async def download_export(
    export_id: UUID, user: CurrentUserDependency, service: ExportServiceDependency
) -> Response:
    content, export = await service.download(export_id, user)
    filename = export.filename or "meeting-export"
    disposition = f"attachment; filename=export; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=content,
        media_type=export.content_type,
        headers={"Content-Disposition": disposition},
    )
