"""Add current transcript projection and append-only edit events.

Revision ID: 20261001_0007
Revises: 20261001_0006
"""

from datetime import datetime, timezone
from decimal import Decimal

from alembic import op
import sqlalchemy as sa

revision = "20261001_0007"
down_revision = "20261001_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transcripts", sa.Column("current_projection_initialized_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transcript_versions", sa.Column("checkpointed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "current_segments",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("transcript_id", sa.Uuid(), sa.ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("logical_segment_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("speaker_id", sa.Uuid(), sa.ForeignKey("speakers.id", ondelete="SET NULL")),
        sa.Column("position", sa.Numeric(30, 15), nullable=False),
        sa.Column("start_ms", sa.BigInteger(), nullable=False), sa.Column("end_ms", sa.BigInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False), sa.Column("original_stt_text", sa.Text()), sa.Column("confidence", sa.Float()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("transcript_id", "position", name="uq_current_segment_position"),
    )
    op.create_index("ix_current_segments_transcript_position", "current_segments", ["transcript_id", "position", "logical_segment_id"])
    op.create_table(
        "transcript_edit_events",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("transcript_id", sa.Uuid(), sa.ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", sa.Uuid(), sa.ForeignKey("transcript_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("event_order", sa.Integer(), nullable=False), sa.Column("event_type", sa.String(32), nullable=False), sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("version_id", "event_order", name="uq_transcript_edit_event_order"),
    )
    op.create_index("ix_transcript_edit_events_transcript_version", "transcript_edit_events", ["transcript_id", "version_id"])
    _backfill_projection()


def _backfill_projection() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    transcripts = sa.Table("transcripts", metadata, autoload_with=bind)
    meetings = sa.Table("meetings", metadata, autoload_with=bind)
    versions = sa.Table("transcript_versions", metadata, autoload_with=bind)
    legacy = sa.Table("segment_versions", metadata, autoload_with=bind)
    current = sa.Table("current_segments", metadata, autoload_with=bind)
    now = datetime.now(timezone.utc)
    for transcript_id, version_id in bind.execute(sa.select(transcripts.c.id, meetings.c.current_transcript_version_id).join(meetings, meetings.c.id == transcripts.c.meeting_id)):
        if version_id is not None:
            rows = bind.execute(sa.select(legacy).where(legacy.c.transcript_version_id == version_id).order_by(legacy.c.sequence)).mappings()
            for sequence, row in enumerate(rows, start=1):
                bind.execute(current.insert().values(id=row["id"], transcript_id=transcript_id, logical_segment_id=row["logical_segment_id"], speaker_id=row["speaker_id"], position=Decimal(sequence * 1024), start_ms=row["start_ms"], end_ms=row["end_ms"], text=row["text"], original_stt_text=row["original_stt_text"], confidence=row["confidence"]))
        bind.execute(transcripts.update().where(transcripts.c.id == transcript_id).values(current_projection_initialized_at=now))
    checkpoint_versions = bind.execute(sa.select(legacy.c.transcript_version_id).distinct()).scalars().all()
    if checkpoint_versions:
        bind.execute(versions.update().where(versions.c.id.in_(checkpoint_versions)).values(checkpointed_at=now))


def downgrade() -> None:
    op.drop_index("ix_transcript_edit_events_transcript_version", table_name="transcript_edit_events")
    op.drop_table("transcript_edit_events")
    op.drop_index("ix_current_segments_transcript_position", table_name="current_segments")
    op.drop_table("current_segments")
    op.drop_column("transcript_versions", "checkpointed_at")
    op.drop_column("transcripts", "current_projection_initialized_at")
