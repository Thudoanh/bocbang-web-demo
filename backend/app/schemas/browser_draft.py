from datetime import datetime
from typing import Literal

from pydantic import BaseModel


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
