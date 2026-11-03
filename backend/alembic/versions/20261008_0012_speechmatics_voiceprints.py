"""Replace legacy MFCC embeddings with Speechmatics speaker identifiers.

Revision ID: 20261008_0012
Revises: 20261008_0011

Existing embeddings cannot be converted into provider voiceprints. Upgrade
therefore removes those profiles and clears their speaker references first.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261008_0012"
down_revision = "20261008_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE speakers SET voice_profile_id = NULL"))
    op.execute(sa.text("DELETE FROM voice_profiles"))
    with op.batch_alter_table("voice_profiles") as batch_op:
        batch_op.alter_column(
            "embedding",
            new_column_name="speaker_identifiers",
            existing_type=sa.JSON(),
            existing_nullable=False,
        )
        batch_op.add_column(
            sa.Column(
                "provider",
                sa.String(length=32),
                nullable=False,
                server_default="speechmatics",
            )
        )
        batch_op.add_column(
            sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.create_index("uq_voice_profiles_user_id", ["user_id"], unique=True)


def downgrade() -> None:
    # Schema is recoverable, but deleted MFCC vectors intentionally are not.
    op.execute(sa.text("UPDATE speakers SET voice_profile_id = NULL"))
    op.execute(sa.text("DELETE FROM voice_profiles"))
    with op.batch_alter_table("voice_profiles") as batch_op:
        batch_op.drop_index("uq_voice_profiles_user_id")
        batch_op.drop_column("sample_count")
        batch_op.drop_column("provider")
        batch_op.alter_column(
            "speaker_identifiers",
            new_column_name="embedding",
            existing_type=sa.JSON(),
            existing_nullable=False,
        )
