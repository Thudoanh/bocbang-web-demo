from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BrowserDraftResponse(BaseModel):
    type: Literal["transcript.partial"] = "transcript.partial"
    stream_segment_id: str
    language: str
    text: str
    start_ms: int
    end_ms: int
    revision: int
    draft_saved_revision: int
    draft_saved_at: datetime
    recognition_status: Literal["unconfirmed"] | None = None


class BrowserDraftResolveRequest(BaseModel):
    stream_segment_id: str = Field(min_length=1, max_length=160)
    revision: int = Field(ge=0, strict=True)
    action: Literal["confirm", "discard", "recover"]
