"""Authenticated endpoints for user and meeting guest voice profiles."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status

from app.api.v1.routes.auth import CurrentUserDependency
from app.core.dependencies import DatabaseSessionDependency
from app.core.errors import ApiError
from app.schemas.voice_profile import VoiceProfileResponse
from app.services.voice_profiles import VoiceProfileService

voice_profiles_router = APIRouter(prefix="/voice-profiles")
meeting_voice_profiles_router = APIRouter(prefix="/meetings")


async def get_voice_profile_service(
    session: DatabaseSessionDependency,
) -> VoiceProfileService:
    return VoiceProfileService(session)


VoiceProfileServiceDependency = Annotated[
    VoiceProfileService, Depends(get_voice_profile_service)
]


@voice_profiles_router.get("/me", response_model=VoiceProfileResponse)
async def get_my_voice_profile(
    user: CurrentUserDependency,
    service: VoiceProfileServiceDependency,
) -> VoiceProfileResponse:
    profile = await service.get_user_profile(user)
    if profile is None:
        raise ApiError("VOICE_PROFILE_NOT_FOUND", "Chưa đăng ký mẫu giọng cá nhân.", 404)
    return VoiceProfileResponse.model_validate(profile)


@voice_profiles_router.post(
    "/me", response_model=VoiceProfileResponse, status_code=status.HTTP_201_CREATED
)
async def enroll_my_voice_profile(
    user: CurrentUserDependency,
    service: VoiceProfileServiceDependency,
    file: UploadFile = File(...),
) -> VoiceProfileResponse:
    content = await file.read()
    profile = await service.enroll_user_profile(user, content)
    return VoiceProfileResponse.model_validate(profile)


@voice_profiles_router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_voice_profile(
    user: CurrentUserDependency,
    service: VoiceProfileServiceDependency,
) -> Response:
    await service.delete_user_profile(user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@meeting_voice_profiles_router.get(
    "/{meeting_id}/voice-profiles", response_model=list[VoiceProfileResponse]
)
async def list_meeting_voice_profiles(
    meeting_id: UUID,
    user: CurrentUserDependency,
    service: VoiceProfileServiceDependency,
) -> list[VoiceProfileResponse]:
    profiles = await service.list_profiles_for_meeting(meeting_id, user)
    return [VoiceProfileResponse.model_validate(p) for p in profiles]


@meeting_voice_profiles_router.post(
    "/{meeting_id}/voice-profiles",
    response_model=VoiceProfileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def enroll_meeting_guest_voice_profile(
    meeting_id: UUID,
    user: CurrentUserDependency,
    service: VoiceProfileServiceDependency,
    name: str = Form(...),
    file: UploadFile = File(...),
) -> VoiceProfileResponse:
    content = await file.read()
    profile = await service.enroll_meeting_guest(meeting_id, user, name, content)
    return VoiceProfileResponse.model_validate(profile)


@meeting_voice_profiles_router.delete(
    "/{meeting_id}/voice-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_meeting_guest_voice_profile(
    meeting_id: UUID,
    profile_id: UUID,
    user: CurrentUserDependency,
    service: VoiceProfileServiceDependency,
) -> Response:
    await service.delete_meeting_guest(meeting_id, profile_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
