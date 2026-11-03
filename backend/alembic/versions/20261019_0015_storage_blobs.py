"""Add storage_blobs table for durable database media storage.

Revision ID: 20261019_0015
Revises: 20261014_0014
"""

from alembic import op
import sqlalchemy as sa

revision = "20261019_0015"
down_revision = "20261014_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLAlchemy renders BLOB/BYTEA and a portable current-time expression for
    # the active dialect. Raw PostgreSQL DDL broke clean SQLite migrations.
    op.create_table(
        "storage_blobs",
        sa.Column("storage_key", sa.String(length=1024), primary_key=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS storage_blobs")
