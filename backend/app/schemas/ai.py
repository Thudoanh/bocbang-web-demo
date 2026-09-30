"""Public schemas for asynchronous translations and AI summaries."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import SummaryTemplateType


class TranslationCreateRequest(BaseModel):
    source_language: str = Field(min_length=2, max_length=35)
    target_language: str = Field(min_length=2, max_length=35)

    @field_validator("source_language", "target_language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        return value.strip().lower()


class TranslationSegmentResponse(BaseModel):
    logical_segment_id: UUID
    sequence: int
    text: str


class TranslationResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    transcript_version_id: UUID
    source_language: str
    target_language: str
    created_at: datetime
    segments: list[TranslationSegmentResponse]


class SummaryCreateRequest(BaseModel):
    template: SummaryTemplateType


class SummaryVersionResponse(BaseModel):
    id: UUID
    version_no: int
    content: dict[str, object]
    provider: str
    model: str
    created_by: UUID | None
    created_at: datetime


class SummaryResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    transcript_version_id: UUID
    template: SummaryTemplateType
    current_version: SummaryVersionResponse
