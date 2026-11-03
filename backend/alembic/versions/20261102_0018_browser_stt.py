"""Store the realtime STT mode; existing meetings keep Cloud."""

from alembic import op
import sqlalchemy as sa

revision = "20261102_0018"
down_revision = "20261020_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meetings", sa.Column("stt_mode", sa.String(16), nullable=False, server_default="cloud"))


def downgrade() -> None:
    op.drop_column("meetings", "stt_mode")
