"""Collaboration comment and capability-link response contracts."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import MeetingPermission
from app.schemas.meeting import MeetingResponse


class CommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    segment_logical_id: UUID | None = None

    @field_validator("body")
    @classmethod
    def strip_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Comment body cannot be blank.")
        return value


class CommentUpdateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)

    @field_validator("body")
    @classmethod
    def strip_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Comment body cannot be blank.")
        return value


class CommentResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    segment_logical_id: UUID | None
    author_id: UUID
    body: str
    created_at: datetime
    updated_at: datetime


class ShareAccessResponse(BaseModel):
    meeting: MeetingResponse
    permission: MeetingPermission
