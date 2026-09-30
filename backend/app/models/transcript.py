"""Transcript snapshot/version history and meeting speaker models."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import TranscriptVersionSource, domain_enum
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.summary import Summary
    from app.models.translation import Translation
    from app.models.user import User


class Transcript(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "transcripts"

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    meeting: Mapped[Meeting] = relationship(back_populates="transcript")
    versions: Mapped[list[TranscriptVersion]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan", passive_deletes=True
    )


class TranscriptVersion(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "transcript_versions"
    __table_args__ = (UniqueConstraint("transcript_id", "version_no", name="uq_transcript_version_no"),)

    transcript_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[TranscriptVersionSource] = mapped_column(
        domain_enum(TranscriptVersionSource, "transcript_version_source"), nullable=False
    )
    parent_version_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("transcript_versions.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    transcript: Mapped[Transcript] = relationship(back_populates="versions")
    parent_version: Mapped[TranscriptVersion | None] = relationship(
        remote_side="TranscriptVersion.id", foreign_keys=[parent_version_id]
    )
    created_by_user: Mapped[User | None] = relationship(
        back_populates="created_transcript_versions", foreign_keys=[created_by]
    )
    segments: Mapped[list[SegmentVersion]] = relationship(
        back_populates="transcript_version", cascade="all, delete-orphan", passive_deletes=True
    )
    translations: Mapped[list[Translation]] = relationship(back_populates="transcript_version")
    summaries: Mapped[list[Summary]] = relationship(back_populates="transcript_version")


class SegmentVersion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "segment_versions"
    __table_args__ = (
        UniqueConstraint("transcript_version_id", "sequence", name="uq_segment_version_sequence"),
    )

    transcript_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcript_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logical_segment_id: Mapped[UUID] = mapped_column(nullable=False, default=uuid4, index=True)
    speaker_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    original_stt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    transcript_version: Mapped[TranscriptVersion] = relationship(back_populates="segments")
    speaker: Mapped[Speaker | None] = relationship(back_populates="segments")


class Speaker(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "speakers"

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_speaker_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_identified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    meeting: Mapped[Meeting] = relationship(back_populates="speakers")
    segments: Mapped[list[SegmentVersion]] = relationship(back_populates="speaker")
