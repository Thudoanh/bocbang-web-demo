"""Voice profile persistence model for enrolled speaker identification."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.transcript import Speaker
    from app.models.user import User


class VoiceProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "voice_profiles"
    __table_args__ = (
        Index("ix_voice_profiles_user_id", "user_id"),
        Index("ix_voice_profiles_meeting_id", "meeting_id"),
    )

    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    meeting_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sample_duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    audio_storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    embedding: Mapped[list[float]] = mapped_column(JSON, nullable=False)

    user: Mapped[User | None] = relationship(back_populates="voice_profiles")
    meeting: Mapped[Meeting | None] = relationship(back_populates="voice_profiles")
    speakers: Mapped[list[Speaker]] = relationship(back_populates="voice_profile")
