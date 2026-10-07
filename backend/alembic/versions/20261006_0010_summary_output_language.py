"""Store summaries separately by output language.

Revision ID: 20261006_0010
Revises: 20261005_0009
"""

import sqlalchemy as sa

from alembic import op

revision = "20261006_0010"
down_revision = "20261005_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("summaries") as batch_op:
        batch_op.add_column(sa.Column("output_language", sa.String(length=2), nullable=True))

    op.execute(
        """
        UPDATE summaries
        SET output_language = COALESCE(
            (
                SELECT CASE
                    WHEN meetings.language_mode IN ('vi', 'en') THEN meetings.language_mode
                    ELSE 'vi'
                END
                FROM meetings
                WHERE meetings.id = summaries.meeting_id
            ),
            'vi'
        )
        """
    )

    with op.batch_alter_table("summaries") as batch_op:
        batch_op.alter_column("output_language", existing_type=sa.String(length=2), nullable=False)
        batch_op.create_unique_constraint(
            "uq_summary_transcript_template_language",
            ["meeting_id", "transcript_version_id", "template_type", "output_language"],
        )


def downgrade() -> None:
    with op.batch_alter_table("summaries") as batch_op:
        batch_op.drop_constraint("uq_summary_transcript_template_language", type_="unique")
        batch_op.drop_column("output_language")