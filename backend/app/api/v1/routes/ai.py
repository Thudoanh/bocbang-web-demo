"""ACL-protected asynchronous translation and summary APIs."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.core.dependencies import get_database
from app.db.session import Database
from app.providers.contracts import LLMProvider, TranslationProvider
from app.schemas.ai import (
    SummaryCreateRequest,
    SummaryResponse,
    SummaryVersionResponse,
    TranslationCreateRequest,
    TranslationResponse,
)
from app.schemas.media import JobResponse
from app.services.ai import AIJobDispatcher, AIService

meetings_router = APIRouter(prefix="/meetings")
translations_router = APIRouter(prefix="/translations")
summaries_router = APIRouter(prefix="/summaries")


async def get_ai_service(request: Request) -> AsyncIterator[AIService]:
    database: Database = get_database(request)
    async with database.session() as session:
        yield AIService(
            session,
            cast(TranslationProvider | None, request.app.state.translation_provider),
            cast(LLMProvider | None, request.app.state.llm_provider),
        )


AIServiceDependency = Annotated[AIService, Depends(get_ai_service)]


@meetings_router.post("/{meeting_id}/translations", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_translation(meeting_id: UUID, payload: TranslationCreateRequest, user: CurrentUserDependency, service: AIServiceDependency, request: Request) -> JobResponse:
    job = await service.request_translation(meeting_id, user, payload)
    cast(AIJobDispatcher, request.app.state.ai_job_dispatcher).enqueue(job.id)
    return job


@meetings_router.get("/{meeting_id}/translations", response_model=list[TranslationResponse])
async def list_translations(meeting_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> list[TranslationResponse]:
    return await service.list_translations(meeting_id, user)


@translations_router.get("/{translation_id}", response_model=TranslationResponse)
async def get_translation(translation_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> TranslationResponse:
    return await service.translation(translation_id, user)


@meetings_router.post("/{meeting_id}/summaries", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_summary(meeting_id: UUID, payload: SummaryCreateRequest, user: CurrentUserDependency, service: AIServiceDependency, request: Request) -> JobResponse:
    job = await service.request_summary(meeting_id, user, payload)
    cast(AIJobDispatcher, request.app.state.ai_job_dispatcher).enqueue(job.id)
    return job


@meetings_router.get("/{meeting_id}/summaries", response_model=list[SummaryResponse])
async def list_summaries(meeting_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> list[SummaryResponse]:
    return await service.list_summaries(meeting_id, user)


@summaries_router.get("/{summary_id}", response_model=SummaryResponse)
async def get_summary(summary_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> SummaryResponse:
    return await service.summary(summary_id, user)


@summaries_router.get("/{summary_id}/versions", response_model=list[SummaryVersionResponse])
async def get_summary_versions(summary_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> list[SummaryVersionResponse]:
    return await service.summary_versions(summary_id, user)


@summaries_router.get("/{summary_id}/versions/{version_id}", response_model=SummaryVersionResponse)
async def get_summary_version(summary_id: UUID, version_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> SummaryVersionResponse:
    return await service.summary_version(summary_id, version_id, user)
