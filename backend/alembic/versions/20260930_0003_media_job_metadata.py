"""Add media-job metadata required for queue monitoring.

Revision ID: 20260930_0003
Revises: 20260930_0002
Create Date: 2026-09-30
"""

from alembic import op
import sqlalchemy as sa


revision = "20260930_0003"
down_revision = "20260930_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Batch mode keeps the migration executable by the SQLite migration test,
    # while PostgreSQL retains the named FK/index used in production.
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("media_file_id", sa.Uuid(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "job_type",
                sa.String(length=64),
                nullable=False,
                server_default=sa.text("'media_processing'"),
            )
        )
        batch_op.add_column(
            sa.Column("progress", sa.Integer(), nullable=False, server_default=sa.text("0"))
        )
        batch_op.add_column(sa.Column("error_code", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("error_message", sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            "fk_jobs_media_file_id_media_files",
            "media_files",
            ["media_file_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_jobs_media_file_id", ["media_file_id"])


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_index("ix_jobs_media_file_id")
        batch_op.drop_constraint("fk_jobs_media_file_id_media_files", type_="foreignkey")
        batch_op.drop_column("error_message")
        batch_op.drop_column("error_code")
        batch_op.drop_column("progress")
        batch_op.drop_column("job_type")
        batch_op.drop_column("media_file_id")
