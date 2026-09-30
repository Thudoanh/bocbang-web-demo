"""Transcript version and speaker REST endpoints."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.core.dependencies import get_database
from app.db.session import Database
from app.schemas.transcript import (
    SegmentEditRequest,
    SegmentMergeRequest,
    SegmentSpeakerRequest,
    SegmentSplitRequest,
    SpeakerCreateRequest,
    SpeakerResponse,
    SpeakerUpdateRequest,
    TranscriptMutationResponse,
    TranscriptResponse,
    TranscriptVersionResponse,
)
from app.services.transcripts import TranscriptService

meetings_router = APIRouter(prefix="/meetings")
segments_router = APIRouter(prefix="/segments")
speakers_router = APIRouter(prefix="/speakers")


async def get_transcript_service(request: Request) -> AsyncIterator[TranscriptService]:
    database: Database = get_database(request)
    async with database.session() as session:
        yield TranscriptService(session)


TranscriptServiceDependency = Annotated[TranscriptService, Depends(get_transcript_service)]


@meetings_router.get("/{meeting_id}/transcript", response_model=TranscriptResponse)
async def current_transcript(meeting_id: UUID, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptResponse:
    return await service.current(meeting_id, user)


@meetings_router.get("/{meeting_id}/transcript/versions", response_model=list[TranscriptVersionResponse])
async def transcript_versions(meeting_id: UUID, user: CurrentUserDependency, service: TranscriptServiceDependency) -> list[TranscriptVersionResponse]:
    return await service.versions(meeting_id, user)


@meetings_router.get("/{meeting_id}/transcript/versions/{version_id}", response_model=TranscriptResponse)
async def transcript_version(meeting_id: UUID, version_id: UUID, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptResponse:
    return await service.version(meeting_id, version_id, user)


@meetings_router.get("/{meeting_id}/speakers", response_model=list[SpeakerResponse])
async def list_speakers(meeting_id: UUID, user: CurrentUserDependency, service: TranscriptServiceDependency) -> list[SpeakerResponse]:
    return await service.list_speakers(meeting_id, user)


@meetings_router.post("/{meeting_id}/speakers", response_model=SpeakerResponse, status_code=status.HTTP_201_CREATED)
async def create_speaker(meeting_id: UUID, payload: SpeakerCreateRequest, user: CurrentUserDependency, service: TranscriptServiceDependency) -> SpeakerResponse:
    return await service.create_speaker(meeting_id, user, payload)


@segments_router.patch("/{logical_segment_id}", response_model=TranscriptMutationResponse)
async def edit_segment(logical_segment_id: UUID, payload: SegmentEditRequest, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptMutationResponse:
    return await service.edit_segment(logical_segment_id, user, payload)


@segments_router.delete("/{logical_segment_id}", response_model=TranscriptMutationResponse)
async def delete_segment(logical_segment_id: UUID, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptMutationResponse:
    return await service.delete_segment(logical_segment_id, user)


@segments_router.post("/{logical_segment_id}/split", response_model=TranscriptMutationResponse)
async def split_segment(logical_segment_id: UUID, payload: SegmentSplitRequest, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptMutationResponse:
    return await service.split_segment(logical_segment_id, user, payload)


@segments_router.post("/merge", response_model=TranscriptMutationResponse)
async def merge_segments(payload: SegmentMergeRequest, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptMutationResponse:
    return await service.merge_segments(payload, user)


@segments_router.patch("/{logical_segment_id}/speaker", response_model=TranscriptMutationResponse)
async def set_segment_speaker(logical_segment_id: UUID, payload: SegmentSpeakerRequest, user: CurrentUserDependency, service: TranscriptServiceDependency) -> TranscriptMutationResponse:
    return await service.assign_speaker(logical_segment_id, user, payload)


@speakers_router.patch("/{speaker_id}", response_model=SpeakerResponse)
async def update_speaker(speaker_id: UUID, payload: SpeakerUpdateRequest, user: CurrentUserDependency, service: TranscriptServiceDependency) -> SpeakerResponse:
    return await service.update_speaker(speaker_id, user, payload)
