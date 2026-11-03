"""Recoverable Web Speech hypotheses, separate from confirmed transcripts."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BrowserTranscriptDraft(Base):
    __tablename__ = "browser_transcript_drafts"
    __table_args__ = (CheckConstraint("end_ms > start_ms", name="ck_browser_draft_interval"),)

    meeting_id: Mapped[UUID] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True)
    stream_segment_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    language: Mapped[str] = mapped_column(String(35), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    recognition_status: Mapped[str | None] = mapped_column(String(24))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
