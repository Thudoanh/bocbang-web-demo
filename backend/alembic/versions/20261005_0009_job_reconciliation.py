"""Add the durable retry schedule used by queue reconciliation.

Revision ID: 20261005_0009
Revises: 20261005_0008
"""

from alembic import op
import sqlalchemy as sa


revision = "20261005_0009"
down_revision = "20261005_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index("ix_jobs_reconcile", ["status", "next_attempt_at"])


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_index("ix_jobs_reconcile")
        batch_op.drop_column("next_attempt_at")
