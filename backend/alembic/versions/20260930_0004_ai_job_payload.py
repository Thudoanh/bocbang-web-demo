"""Persist AI job request payloads and retryability.

Revision ID: 20260930_0004
Revises: 20260930_0003
Create Date: 2026-09-30
"""

from alembic import op
import sqlalchemy as sa


revision = "20260930_0004"
down_revision = "20260930_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("error_retryable", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("payload", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_column("payload")
        batch_op.drop_column("error_retryable")
