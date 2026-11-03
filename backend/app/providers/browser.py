"""Ingest authenticated Web Speech text. Audio is retained, never sent to Cloud STT."""

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

from app.providers.contracts import (
    STTCapabilities, StreamingOptions, StreamingTranscriptionEvent, TranscriptionSegment,
)


class BrowserTranscriptMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["transcript.browser"]
    result_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9:_-]+$")
    final: bool
    text: str = Field(max_length=64000)
    revision: int = Field(default=0, ge=0, strict=True)
    save_draft: bool = False
    recognition_status: Literal["unconfirmed", "withdrawn"] | None = None
    start_ms: int = Field(ge=0, strict=True)
    end_ms: int = Field(gt=0, strict=True)

    @model_validator(mode="after")
    def validate_interval(self):
        if self.end_ms <= self.start_ms:
            raise ValueError("Browser transcript text and interval must be valid.")
        if self.final and self.recognition_status is not None:
            raise ValueError("Only engine-confirmed results can be final.")
        if self.recognition_status == "withdrawn":
            if self.text.strip():
                raise ValueError("A withdrawn preview must have empty text.")
        elif not self.text.strip():
            raise ValueError("Browser transcript text must not be empty.")
        return self


class BrowserSTTStream:
    provider_name = "browser-web-speech"
    speaker_identification_available = False
    fallback_active = False

    def __init__(self, language: str) -> None:
        self.language = "en" if language.startswith("en") else "vi"
        self._finalized: set[str] = set()
        self._revisions: dict[str, int] = {}
        self._last_end_ms = 0

    def accept(self, message: BrowserTranscriptMessage, audio_end_ms: int):
        # Timestamps are approximate client measurements, bounded by retained audio.
        if message.end_ms > audio_end_ms + 1500:
            raise ValueError("Browser transcript exceeds the recorded audio clock.")
        if message.result_id in self._finalized:
            return ()
        if message.revision < self._revisions.get(message.result_id, 0):
            return ()
        self._revisions[message.result_id] = message.revision
        start = max(message.start_ms, self._last_end_ms)
        end = max(start + 1, message.end_ms)
        if message.final:
            self._finalized.add(message.result_id)
            self._last_end_ms = end
        return (StreamingTranscriptionEvent(
            type="final" if message.final else "partial", language=self.language,
            segment=TranscriptionSegment(start, end, message.text.strip()),
            stream_segment_id=message.result_id,
            recognition_status=message.recognition_status,
            browser_revision=message.revision,
            save_browser_draft=message.save_draft,
        ),)

    async def send_audio(self, chunk: bytes):
        return ()

    async def pause(self):
        return ()

    async def resume(self):
        return ()

    async def close(self):
        return ()


class BrowserSTTProvider:
    def capabilities(self):
        return STTCapabilities(
            batch=False, streaming=True, diarization=False, timestamps=False,
            confidence=False, supported_languages=frozenset({"vi", "en"}),
            multilingual_auto_detect=False,
        )

    async def open_stream(self, options: StreamingOptions):
        return BrowserSTTStream(options.language)
