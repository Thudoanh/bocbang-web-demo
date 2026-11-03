"""Enforce one local user per Google OpenID subject.

Revision ID: 20260930_0002
Revises: 20260930_0001
Create Date: 2026-09-30
"""

from alembic import op


revision = "20260930_0002"
down_revision = "20260930_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.create_unique_constraint("uq_users_google_subject", ["google_subject"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("uq_users_google_subject", type_="unique")
