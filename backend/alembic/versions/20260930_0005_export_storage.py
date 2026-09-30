"""Persist generated export object metadata.

Revision ID: 20260930_0005
Revises: 20260930_0004
"""

from alembic import op
import sqlalchemy as sa

revision = "20260930_0005"
down_revision = "20260930_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("exports") as batch_op:
        batch_op.add_column(sa.Column("storage_key", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("content_type", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("filename", sa.String(length=512), nullable=True))
        batch_op.create_unique_constraint("uq_exports_storage_key", ["storage_key"])


def downgrade() -> None:
    with op.batch_alter_table("exports") as batch_op:
        batch_op.drop_constraint("uq_exports_storage_key", type_="unique")
        batch_op.drop_column("filename")
        batch_op.drop_column("content_type")
        batch_op.drop_column("storage_key")
