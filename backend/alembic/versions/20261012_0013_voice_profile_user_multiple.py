"""Allow multiple voice profiles per user by dropping unique constraint on user_id.

Revision ID: 20261012_0013
Revises: 20261008_0012
"""

from alembic import op

revision = "20261012_0013"
down_revision = "20261008_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("voice_profiles") as batch_op:
        batch_op.drop_index("uq_voice_profiles_user_id")


def downgrade() -> None:
    with op.batch_alter_table("voice_profiles") as batch_op:
        batch_op.create_index("uq_voice_profiles_user_id", ["user_id"], unique=True)
