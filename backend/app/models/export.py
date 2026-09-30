"""Persisted export requests and their transcript-version provenance."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ExportFormat, domain_enum
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.transcript import TranscriptVersion


class Export(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "exports"

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transcript_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("transcript_versions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    format: Mapped[ExportFormat] = mapped_column(
        domain_enum(ExportFormat, "export_format"), nullable=False
    )
    storage_key: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(512), nullable=True)

    meeting: Mapped[Meeting] = relationship(back_populates="exports")
    transcript_version: Mapped[TranscriptVersion] = relationship()
