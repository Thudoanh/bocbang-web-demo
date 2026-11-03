"""Transcript snapshot/version history and meeting speaker models."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import TranscriptVersionSource, domain_enum
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.summary import Summary
    from app.models.translation import Translation
    from app.models.user import User
    from app.models.voice_profile import VoiceProfile


class Transcript(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "transcripts"

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    current_projection_initialized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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
    checkpointed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
        Index(
            "ix_segment_versions_logical_id_transcript_version_id",
            "logical_segment_id",
            "transcript_version_id",
        ),
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


class CurrentSegment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Materialized current transcript state; never used for historical snapshots."""

    __tablename__ = "current_segments"
    __table_args__ = (
        UniqueConstraint("transcript_id", "position", name="uq_current_segment_position"),
        Index(
            "ix_current_segments_transcript_position",
            "transcript_id",
            "position",
            "logical_segment_id",
        ),
    )

    transcript_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logical_segment_id: Mapped[UUID] = mapped_column(nullable=False, unique=True, default=uuid4)
    speaker_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("speakers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    position: Mapped[Decimal] = mapped_column(Numeric(30, 15), nullable=False)
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    original_stt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)


class TranscriptEditEvent(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Append-only changes applied to a projected transcript revision."""

    __tablename__ = "transcript_edit_events"
    __table_args__ = (
        UniqueConstraint("version_id", "event_order", name="uq_transcript_edit_event_order"),
        Index("ix_transcript_edit_events_transcript_version", "transcript_id", "version_id"),
    )

    transcript_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    version_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcript_versions.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    event_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)


class Speaker(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "speakers"

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    voice_profile_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("voice_profiles.id", ondelete="SET NULL"), nullable=True, index=True
    )
    match_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider_speaker_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_identified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    meeting: Mapped[Meeting] = relationship(back_populates="speakers")
    voice_profile: Mapped[VoiceProfile | None] = relationship(back_populates="speakers")
    segments: Mapped[list[SegmentVersion]] = relationship(back_populates="speaker")
