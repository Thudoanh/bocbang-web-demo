"""ACL-protected asynchronous translation and summary APIs."""

from __future__ import annotations

import asyncio
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
    SummaryEditRequest,
    SummaryResponse,
    SummaryVersionResponse,
    TranslationCreateRequest,
    TranslationResponse,
)
from app.schemas.media import JobResponse
from app.schemas.transcript_polish import PolishResponse, PolishReviewRequest
from app.services.ai import AIService
from app.services.transcript_polish import TranscriptPolishService
from app.workers.lifecycle import fail_enqueue

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


@meetings_router.get("/{meeting_id}/transcript/polish", response_model=PolishResponse | None)
async def latest_polish(meeting_id: UUID, user: CurrentUserDependency, request: Request):
    async with get_database(request).session() as session:
        return await TranscriptPolishService(session, request.app.state.llm_provider).latest(meeting_id, user)


@meetings_router.post("/{meeting_id}/transcript/polish", response_model=PolishResponse, status_code=202)
async def create_polish(meeting_id: UUID, user: CurrentUserDependency, request: Request):
    from app.services.transcript_polish import response
    async with get_database(request).session() as session:
        job = await TranscriptPolishService(session, request.app.state.llm_provider).request(meeting_id, user)
        # Commit exists before publishing; reconciler retries delivery if Redis is down.
        try:
            request.app.state.enqueue_job(job.id, request.app.state.settings)
        except Exception:
            await fail_enqueue(get_database(request), job.id)
        return response(job)


@meetings_router.patch("/{meeting_id}/transcript/polish/{job_id}", response_model=PolishResponse)
async def save_polish(meeting_id: UUID, job_id: UUID, payload: PolishReviewRequest, user: CurrentUserDependency, request: Request):
    async with get_database(request).session() as session:
        return await TranscriptPolishService(session, request.app.state.llm_provider).review(meeting_id, job_id, user, payload, accept=False)


@meetings_router.post("/{meeting_id}/transcript/polish/{job_id}/accept", response_model=PolishResponse)
async def accept_polish(meeting_id: UUID, job_id: UUID, payload: PolishReviewRequest, user: CurrentUserDependency, request: Request):
    async with get_database(request).session() as session:
        return await TranscriptPolishService(session, request.app.state.llm_provider).review(meeting_id, job_id, user, payload, accept=True)


@meetings_router.post("/{meeting_id}/translations", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_translation(meeting_id: UUID, payload: TranslationCreateRequest, user: CurrentUserDependency, service: AIServiceDependency, request: Request) -> JobResponse:
    job = await service.request_translation(meeting_id, user, payload)
    try:
        request.app.state.enqueue_job(job.id, request.app.state.settings)
    except Exception:
        async def _run_in_process():
            try:
                from app.services.ai import AIJobDispatcher
                dispatcher = AIJobDispatcher(
                    get_database(request),
                    request.app.state.settings,
                    getattr(request.app.state, "translation_provider", None),
                    getattr(request.app.state, "llm_provider", None),
                    request.app.state.media_storage,
                )
                await dispatcher.run(job.id)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning("In-process translation execution failed: %s", exc)

        asyncio.create_task(_run_in_process())
    return job


@meetings_router.get("/{meeting_id}/translations", response_model=list[TranslationResponse])
async def list_translations(meeting_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> list[TranslationResponse]:
    return await service.list_translations(meeting_id, user)



from pydantic import BaseModel, Field

class InstantTranslateRequest(BaseModel):
    text: str | None = None
    texts: list[str] | None = None
    source_language: str = "auto"
    target_language: str = "vi"

class InstantTranslateResponse(BaseModel):
    translated: str = ""
    translations: list[str] = Field(default_factory=list)

async def _gtx_translate_single(client: httpx.AsyncClient, text: str, source: str, target: str) -> str:
    from urllib.parse import quote
    import re
    clean = text.strip()
    if not clean:
        return ""
    # Smart bidirectional target detection:
    is_vi = any(c in clean.casefold() for c in "ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ")
    if not is_vi:
        is_vi = bool(re.search(r"\b(và|của|là|được|không|tôi|em|anh|chị|mọi|người|xin|chào|cảm|ơn|có|thì|với|trong|này|đó|cho|đã|sẽ|rồi|nhé|gì|nào|sao|đây)\b", clean.casefold()))
    tl = "en" if is_vi else "vi"
    sl = "auto"
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={sl}&tl={tl}&dt=t&q={quote(clean)}"
    try:
        resp = await client.get(url, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                return "".join(part[0] for part in data[0] if isinstance(part, list) and part and part[0])
    except Exception:
        pass
    return clean


@translations_router.post("/instant", response_model=InstantTranslateResponse)
async def instant_translate(payload: InstantTranslateRequest, request: Request) -> InstantTranslateResponse:
    import asyncio
    import httpx
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    async with httpx.AsyncClient(headers=headers, timeout=6.0) as client:
        if payload.texts:
            tasks = [_gtx_translate_single(client, t, payload.source_language, payload.target_language) for t in payload.texts]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            translations = [r if isinstance(r, str) else t for r, t in zip(results, payload.texts)]
            return InstantTranslateResponse(translations=translations)
        elif payload.text:
            translated = await _gtx_translate_single(client, payload.text, payload.source_language, payload.target_language)
            return InstantTranslateResponse(translated=translated)
    return InstantTranslateResponse()

@translations_router.get("/{translation_id}", response_model=TranslationResponse)
async def get_translation(translation_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> TranslationResponse:
    return await service.translation(translation_id, user)


@meetings_router.post("/{meeting_id}/summaries", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_summary(meeting_id: UUID, payload: SummaryCreateRequest, user: CurrentUserDependency, service: AIServiceDependency, request: Request) -> JobResponse:
    job = await service.request_summary(meeting_id, user, payload)
    try:
        request.app.state.enqueue_job(job.id, request.app.state.settings)
    except Exception:
        await fail_enqueue(get_database(request), job.id)
        from app.core.errors import ApiError
        raise ApiError("QUEUE_ENQUEUE_FAILED", "The summary job could not be queued.", 503)
    return job


@meetings_router.get("/{meeting_id}/summaries", response_model=list[SummaryResponse])
async def list_summaries(meeting_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> list[SummaryResponse]:
    return await service.list_summaries(meeting_id, user)


@summaries_router.get("/{summary_id}", response_model=SummaryResponse)
async def get_summary(summary_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> SummaryResponse:
    return await service.summary(summary_id, user)


@summaries_router.patch("/{summary_id}", response_model=SummaryResponse)
async def edit_summary(
    summary_id: UUID,
    payload: SummaryEditRequest,
    user: CurrentUserDependency,
    service: AIServiceDependency,
) -> SummaryResponse:
    return await service.edit_summary(summary_id, user, payload)


@summaries_router.get("/{summary_id}/versions", response_model=list[SummaryVersionResponse])
async def get_summary_versions(summary_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> list[SummaryVersionResponse]:
    return await service.summary_versions(summary_id, user)


@summaries_router.get("/{summary_id}/versions/{version_id}", response_model=SummaryVersionResponse)
async def get_summary_version(summary_id: UUID, version_id: UUID, user: CurrentUserDependency, service: AIServiceDependency) -> SummaryVersionResponse:
    return await service.summary_version(summary_id, version_id, user)
