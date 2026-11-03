"""Keep recoverable Browser hypotheses outside confirmed transcript versions."""
from alembic import op
import sqlalchemy as sa

revision = "20261102_0019"
down_revision = "20261102_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "browser_transcript_drafts",
        sa.Column("meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("stream_segment_id", sa.String(160), primary_key=True),
        sa.Column("language", sa.String(35), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("recognition_status", sa.String(24)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("end_ms > start_ms", name="ck_browser_draft_interval"),
    )


def downgrade() -> None:
    op.drop_table("browser_transcript_drafts")
