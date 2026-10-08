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
from app.services.exports import ExportService
from app.workers.lifecycle import fail_enqueue

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
    try:
        request.app.state.enqueue_job(export.job_id, request.app.state.settings)
    except Exception as exc:
        await fail_enqueue(get_database(request), export.job_id)
        from app.core.errors import ApiError

        raise ApiError(
            "QUEUE_ENQUEUE_FAILED", "The export job could not be queued.", 503
        ) from exc
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
    # Proxy private object storage through the authenticated API. Browser
    # fetches cannot reliably follow a cross-origin presigned redirect unless
    # every S3-compatible bucket has matching CORS rules.
    content, export = await service.download(export_id, user)
    filename = export.filename or "meeting-export"
    disposition = f"attachment; filename=export; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=content,
        media_type=export.content_type,
        headers={"Content-Disposition": disposition},
    )
