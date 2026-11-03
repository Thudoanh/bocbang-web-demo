"""Create the initial PostgreSQL persistence schema.

Revision ID: 20260930_0001
Revises:
Create Date: 2026-09-30
"""

from collections.abc import Iterable

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260930_0001"
down_revision = None
branch_labels = None
depends_on = None


email_otp_purpose = postgresql.ENUM("verify_email", "reset_password", name="email_otp_purpose", create_type=False)
meeting_permission = postgresql.ENUM("read", "comment", "edit", name="meeting_permission", create_type=False)
meeting_source_type = postgresql.ENUM("realtime", "upload", name="meeting_source_type", create_type=False)
meeting_status = postgresql.ENUM("created", "recording", "processing", "completed", "failed", name="meeting_status", create_type=False)
job_status = postgresql.ENUM("queued", "processing", "completed", "failed", name="job_status", create_type=False)
transcript_version_source = postgresql.ENUM("stt", "user_edit", name="transcript_version_source", create_type=False)
summary_template_type = postgresql.ENUM("general", "briefing", "voting", name="summary_template_type", create_type=False)
export_format = postgresql.ENUM("pdf", "docx", "txt", "srt", "vtt", "json", name="export_format", create_type=False)

ENUMS: tuple[postgresql.ENUM, ...] = (
    email_otp_purpose,
    meeting_permission,
    meeting_source_type,
    meeting_status,
    job_status,
    transcript_version_source,
    summary_template_type,
    export_format,
)


def _timestamps(include_updated_at: bool = False) -> list[sa.Column[object]]:
    columns: list[sa.Column[object]] = [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    ]
    if include_updated_at:
        columns.append(
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP"))
        )
    return columns


def _create_enums(enums: Iterable[postgresql.ENUM]) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for enum in enums:
            enum.create(bind, checkfirst=True)


def _drop_enums(enums: Iterable[postgresql.ENUM]) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for enum in enums:
            enum.drop(bind, checkfirst=True)


def upgrade() -> None:
    _create_enums(ENUMS)

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column("google_subject", sa.String(), nullable=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("is_email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_timestamps(include_updated_at=True),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_table(
        "meetings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_type", meeting_source_type, nullable=False),
        sa.Column("language_mode", sa.String(length=35), nullable=False),
        sa.Column("diarization_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", meeting_status, nullable=False, server_default="created"),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("current_transcript_version_id", sa.Uuid(), nullable=True),
        *_timestamps(include_updated_at=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name="fk_meetings_owner_id_users", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_meetings"),
    )
    op.create_index("ix_meetings_owner_id", "meetings", ["owner_id"])
    op.create_index("ix_meetings_status", "meetings", ["status"])
    op.create_table(
        "email_otps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", email_otp_purpose, nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_email_otps_user_id_users", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_email_otps"),
    )
    op.create_index("ix_email_otps_user_id", "email_otps", ["user_id"])
    op.create_table(
        "meeting_members",
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("permission", meeting_permission, nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_meeting_members_meeting_id_meetings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_meeting_members_user_id_users", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("meeting_id", "user_id", name="pk_meeting_members"),
    )
    op.create_table(
        "share_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("permission", meeting_permission, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_share_links_meeting_id_meetings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_share_links_created_by_users", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_share_links"),
        sa.UniqueConstraint("token_hash", name="uq_share_links_token_hash"),
    )
    op.create_index("ix_share_links_meeting_id", "share_links", ["meeting_id"])
    op.create_index("ix_share_links_created_by", "share_links", ["created_by"])
    op.create_table(
        "media_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=False),
        sa.Column("normalized_storage_key", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_media_files_meeting_id_meetings", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_media_files"),
    )
    op.create_index("ix_media_files_meeting_id", "media_files", ["meeting_id"])
    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("status", job_status, nullable=False, server_default="queued"),
        *_timestamps(include_updated_at=True),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_jobs_meeting_id_meetings", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_jobs"),
    )
    op.create_index("ix_jobs_meeting_id", "jobs", ["meeting_id"])
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_table(
        "transcripts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_transcripts_meeting_id_meetings", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_transcripts"),
        sa.UniqueConstraint("meeting_id", name="uq_transcripts_meeting_id"),
    )
    op.create_table(
        "speakers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("provider_speaker_id", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=255), nullable=True),
        sa.Column("organization", sa.String(length=255), nullable=True),
        sa.Column("is_identified", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_timestamps(include_updated_at=True),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_speakers_meeting_id_meetings", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_speakers"),
    )
    op.create_index("ix_speakers_meeting_id", "speakers", ["meeting_id"])
    op.create_table(
        "transcript_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("transcript_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("source", transcript_version_source, nullable=False),
        sa.Column("parent_version_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["transcript_id"], ["transcripts.id"], name="fk_transcript_versions_transcript_id_transcripts", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_version_id"], ["transcript_versions.id"], name="fk_transcript_versions_parent_version_id_transcript_versions", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_transcript_versions_created_by_users", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_transcript_versions"),
        sa.UniqueConstraint("transcript_id", "version_no", name="uq_transcript_version_no"),
    )
    op.create_index("ix_transcript_versions_transcript_id", "transcript_versions", ["transcript_id"])
    op.create_index("ix_transcript_versions_created_by", "transcript_versions", ["created_by"])
    op.create_table(
        "segment_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("transcript_version_id", sa.Uuid(), nullable=False),
        sa.Column("logical_segment_id", sa.Uuid(), nullable=False),
        sa.Column("speaker_id", sa.Uuid(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("start_ms", sa.BigInteger(), nullable=False),
        sa.Column("end_ms", sa.BigInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("original_stt_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["transcript_version_id"], ["transcript_versions.id"], name="fk_segment_versions_transcript_version_id_transcript_versions", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["speaker_id"], ["speakers.id"], name="fk_segment_versions_speaker_id_speakers", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_segment_versions"),
        sa.UniqueConstraint("transcript_version_id", "sequence", name="uq_segment_version_sequence"),
    )
    op.create_index("ix_segment_versions_transcript_version_id", "segment_versions", ["transcript_version_id"])
    op.create_index("ix_segment_versions_logical_segment_id", "segment_versions", ["logical_segment_id"])
    op.create_index("ix_segment_versions_speaker_id", "segment_versions", ["speaker_id"])
    op.create_table(
        "comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("segment_logical_id", sa.Uuid(), nullable=True),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(include_updated_at=True),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_comments_meeting_id_meetings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], name="fk_comments_author_id_users", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_comments"),
    )
    op.create_index("ix_comments_meeting_id", "comments", ["meeting_id"])
    op.create_index("ix_comments_segment_logical_id", "comments", ["segment_logical_id"])
    op.create_index("ix_comments_author_id", "comments", ["author_id"])
    op.create_table(
        "translations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("transcript_version_id", sa.Uuid(), nullable=False),
        sa.Column("source_language", sa.String(length=35), nullable=False),
        sa.Column("target_language", sa.String(length=35), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_translations_meeting_id_meetings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["transcript_version_id"], ["transcript_versions.id"], name="fk_translations_transcript_version_id_transcript_versions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_translations"),
    )
    op.create_index("ix_translations_meeting_id", "translations", ["meeting_id"])
    op.create_index("ix_translations_transcript_version_id", "translations", ["transcript_version_id"])
    op.create_table(
        "translation_segments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("translation_id", sa.Uuid(), nullable=False),
        sa.Column("logical_segment_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["translation_id"], ["translations.id"], name="fk_translation_segments_translation_id_translations", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_translation_segments"),
        sa.UniqueConstraint("translation_id", "sequence", name="uq_translation_segment_sequence"),
    )
    op.create_index("ix_translation_segments_translation_id", "translation_segments", ["translation_id"])
    op.create_index("ix_translation_segments_logical_segment_id", "translation_segments", ["logical_segment_id"])
    op.create_table(
        "summaries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("transcript_version_id", sa.Uuid(), nullable=False),
        sa.Column("template_type", summary_template_type, nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_summaries_meeting_id_meetings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["transcript_version_id"], ["transcript_versions.id"], name="fk_summaries_transcript_version_id_transcript_versions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_summaries"),
    )
    op.create_index("ix_summaries_meeting_id", "summaries", ["meeting_id"])
    op.create_index("ix_summaries_transcript_version_id", "summaries", ["transcript_version_id"])
    op.create_table(
        "summary_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("summary_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("provider", sa.String(length=255), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["summary_id"], ["summaries.id"], name="fk_summary_versions_summary_id_summaries", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_summary_versions_created_by_users", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_summary_versions"),
        sa.UniqueConstraint("summary_id", "version_no", name="uq_summary_version_no"),
    )
    op.create_index("ix_summary_versions_summary_id", "summary_versions", ["summary_id"])
    op.create_index("ix_summary_versions_created_by", "summary_versions", ["created_by"])
    op.create_table(
        "exports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("transcript_version_id", sa.Uuid(), nullable=False),
        sa.Column("format", export_format, nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], name="fk_exports_meeting_id_meetings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["transcript_version_id"], ["transcript_versions.id"], name="fk_exports_transcript_version_id_transcript_versions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_exports"),
    )
    op.create_index("ix_exports_meeting_id", "exports", ["meeting_id"])
    op.create_index("ix_exports_transcript_version_id", "exports", ["transcript_version_id"])

    # This cyclic reference cannot be declared before transcript_versions exists.
    if op.get_bind().dialect.name == "postgresql":
        op.create_foreign_key(
            "fk_meetings_current_transcript_version_id_transcript_versions",
            "meetings",
            "transcript_versions",
            ["current_transcript_version_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint("fk_meetings_current_transcript_version_id_transcript_versions", "meetings", type_="foreignkey")
    for table in (
        "exports", "summary_versions", "summaries", "translation_segments", "translations", "comments",
        "segment_versions", "transcript_versions", "speakers", "transcripts", "jobs", "media_files",
        "share_links", "meeting_members", "email_otps", "meetings", "users",
    ):
        op.drop_table(table)
    _drop_enums(reversed(ENUMS))
