"""Add durable queue lifecycle fields and retrying status.

Revision ID: 20261005_0008
Revises: 20261001_0007
"""

from alembic import op
import sqlalchemy as sa


revision = "20261005_0008"
down_revision = "20261001_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL uses a native enum; SQLite tests use a CHECK-less emulation.
    op.execute("ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'retrying'") if op.get_bind().dialect.name == "postgresql" else None
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE jobs SET attempts = 0 WHERE attempts IS NULL")


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_column("completed_at")
        batch_op.drop_column("started_at")
        batch_op.drop_column("attempts")
    # PostgreSQL enum values cannot be removed safely without a table rewrite.
