"""Meeting comments persisted independently from transcript snapshots."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.user import User


class Comment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "comments"
    __table_args__ = (
        Index(
            "ix_comments_meeting_id_created_at_active",
            "meeting_id",
            "created_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    segment_logical_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    author_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meeting: Mapped[Meeting] = relationship(back_populates="comments")
    author: Mapped[User] = relationship(back_populates="comments")
