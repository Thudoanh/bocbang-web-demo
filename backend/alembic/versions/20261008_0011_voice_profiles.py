"""Create voice profiles table and associate with speakers.

Revision ID: 20261008_0011
Revises: 20261006_0010
"""

import sqlalchemy as sa
from alembic import op

revision = "20261008_0011"
down_revision = "20261006_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("meeting_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sample_duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("audio_storage_path", sa.String(length=512), nullable=True),
        sa.Column("embedding", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_voice_profiles_user_id", "voice_profiles", ["user_id"])
    op.create_index("ix_voice_profiles_meeting_id", "voice_profiles", ["meeting_id"])

    with op.batch_alter_table("speakers") as batch_op:
        batch_op.add_column(sa.Column("voice_profile_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("match_confidence", sa.Float(), nullable=True))
        batch_op.create_foreign_key(
            "fk_speakers_voice_profile_id",
            "voice_profiles",
            ["voice_profile_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_speakers_voice_profile_id", ["voice_profile_id"])


def downgrade() -> None:
    with op.batch_alter_table("speakers") as batch_op:
        batch_op.drop_index("ix_speakers_voice_profile_id")
        batch_op.drop_constraint("fk_speakers_voice_profile_id", type_="foreignkey")
        batch_op.drop_column("match_confidence")
        batch_op.drop_column("voice_profile_id")

    op.drop_index("ix_voice_profiles_meeting_id", table_name="voice_profiles")
    op.drop_index("ix_voice_profiles_user_id", table_name="voice_profiles")
    op.drop_table("voice_profiles")
