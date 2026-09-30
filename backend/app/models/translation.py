"""Translations tied to their immutable input transcript version."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.transcript import TranscriptVersion


class Translation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "translations"

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transcript_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcript_versions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    source_language: Mapped[str] = mapped_column(String(35), nullable=False)
    target_language: Mapped[str] = mapped_column(String(35), nullable=False)

    meeting: Mapped[Meeting] = relationship(back_populates="translations")
    transcript_version: Mapped[TranscriptVersion] = relationship(back_populates="translations")
    segments: Mapped[list[TranslationSegment]] = relationship(
        back_populates="translation", cascade="all, delete-orphan", passive_deletes=True
    )


class TranslationSegment(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "translation_segments"
    __table_args__ = (UniqueConstraint("translation_id", "sequence", name="uq_translation_segment_sequence"),)

    translation_id: Mapped[UUID] = mapped_column(
        ForeignKey("translations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logical_segment_id: Mapped[UUID] = mapped_column(nullable=False, default=uuid4, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)

    translation: Mapped[Translation] = relationship(back_populates="segments")
