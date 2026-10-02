from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def migration_config(database_url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_initial_migration_upgrades_and_downgrades_clean_database(tmp_path: Path) -> None:
    database_path = tmp_path / "migration.sqlite3"
    async_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    config = migration_config(async_url)

    command.upgrade(config, "head")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        tables = set(inspect(engine).get_table_names())
        assert {"users", "meetings", "transcripts", "transcript_versions", "summary_versions"} <= tables
        inspector = inspect(engine)
        assert "ix_meeting_members_user_id_meeting_id" in {
            item["name"] for item in inspector.get_indexes("meeting_members")
        }
        assert "ix_meetings_owner_id_updated_at_created_at" in {
            item["name"] for item in inspector.get_indexes("meetings")
        }
        assert "ix_comments_meeting_id_created_at_active" in {
            item["name"] for item in inspector.get_indexes("comments")
        }
        assert "ix_email_otps_user_id_purpose_created_at_active" in {
            item["name"] for item in inspector.get_indexes("email_otps")
        }
        assert "ix_segment_versions_logical_id_transcript_version_id" in {
            item["name"] for item in inspector.get_indexes("segment_versions")
        }
    finally:
        engine.dispose()

    command.downgrade(config, "base")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        assert "users" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()
