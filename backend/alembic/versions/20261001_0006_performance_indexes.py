"""Add read-path indexes for meeting, comment, OTP, and segment lookups.

Revision ID: 20261001_0006
Revises: 20260930_0005
"""

from alembic import op
import sqlalchemy as sa

revision = "20261001_0006"
down_revision = "20260930_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_meeting_members_user_id_meeting_id",
        "meeting_members",
        ["user_id", "meeting_id"],
    )
    op.create_index(
        "ix_meetings_owner_id_updated_at_created_at",
        "meetings",
        ["owner_id", sa.text("updated_at DESC"), sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_comments_meeting_id_created_at_active",
        "comments",
        ["meeting_id", "created_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_email_otps_user_id_purpose_created_at_active",
        "email_otps",
        ["user_id", "purpose", sa.text("created_at DESC")],
        postgresql_where=sa.text("consumed_at IS NULL"),
    )
    op.create_index(
        "ix_segment_versions_logical_id_transcript_version_id",
        "segment_versions",
        ["logical_segment_id", "transcript_version_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_segment_versions_logical_id_transcript_version_id", table_name="segment_versions")
    op.drop_index("ix_email_otps_user_id_purpose_created_at_active", table_name="email_otps")
    op.drop_index("ix_comments_meeting_id_created_at_active", table_name="comments")
    op.drop_index("ix_meetings_owner_id_updated_at_created_at", table_name="meetings")
    op.drop_index("ix_meeting_members_user_id_meeting_id", table_name="meeting_members")
