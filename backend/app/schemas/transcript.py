"""Request and response schemas for transcript snapshots and speakers."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import TranscriptVersionSource


class SpeakerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    meeting_id: UUID
    provider_speaker_id: str | None
    name: str
    role: str | None
    organization: str | None
    is_identified: bool
    created_at: datetime
    updated_at: datetime


class SpeakerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    role: str | None = Field(default=None, max_length=255)
    organization: str | None = Field(default=None, max_length=255)


class SpeakerUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: str | None = Field(default=None, max_length=255)
    organization: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def require_change(self) -> "SpeakerUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided.")
        return self


class SegmentResponse(BaseModel):
    id: UUID
    logical_segment_id: UUID
    start_ms: int
    end_ms: int
    text: str
    speaker_id: UUID | None
    confidence: float | None


class TranscriptResponse(BaseModel):
    version_id: UUID
    version_no: int
    language: str
    segments: list[SegmentResponse]


class TranscriptVersionResponse(BaseModel):
    id: UUID
    version_no: int
    source: TranscriptVersionSource
    parent_version_id: UUID | None
    created_by: UUID | None
    created_at: datetime


class SegmentEditRequest(BaseModel):
    text: str | None = Field(default=None, min_length=1)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_change(self) -> "SegmentEditRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided.")
        if self.start_ms is not None and self.end_ms is not None and self.start_ms >= self.end_ms:
            raise ValueError("start_ms must be earlier than end_ms.")
        return self


class SegmentSplitRequest(BaseModel):
    split_at_ms: int = Field(ge=0)
    first_text: str | None = Field(default=None, min_length=1)
    second_text: str | None = Field(default=None, min_length=1)


class SegmentMergeRequest(BaseModel):
    first_segment_id: UUID
    second_segment_id: UUID


class SegmentSpeakerRequest(BaseModel):
    speaker_id: UUID | None = None


class TranscriptMutationResponse(BaseModel):
    version_id: UUID
    version_no: int
    segment: SegmentResponse | None = None
