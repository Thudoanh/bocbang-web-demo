from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command

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
        assert "meeting_sections" in tables
        assert "meeting_audio_chunks" in tables
        assert {"meeting_id", "recording_id", "start_ms", "end_ms", "storage_key"} <= {
            item["name"] for item in inspect(engine).get_columns("meeting_audio_chunks")
        }
        assert {"users", "meetings", "transcripts", "transcript_versions", "summary_versions", "voice_profiles"} <= tables
        inspector = inspect(engine)
        assert "voice_profile_id" in {
            item["name"] for item in inspector.get_columns("speakers")
        }
        voice_columns = {item["name"] for item in inspector.get_columns("voice_profiles")}
        assert {"speaker_identifiers", "provider", "sample_count"} <= voice_columns
        assert "embedding" not in voice_columns
        assert "ix_voice_profiles_user_id" in {
            item["name"] for item in inspector.get_indexes("voice_profiles")
        }
        assert "output_language" in {
            item["name"] for item in inspector.get_columns("summaries")
        }
        assert "prompt" in {
            item["name"] for item in inspector.get_columns("summary_versions")
        }
        assert "mode" in {
            item["name"] for item in inspector.get_columns("summaries")
        }
        assert "scope" in {item["name"] for item in inspector.get_columns("summaries")}
        assert "uq_summary_input_scope_mode_language" in {
            item["name"] for item in inspector.get_unique_constraints("summaries")
        }
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


def test_meeting_sections_migration_backfills_legacy_meetings_without_touching_transcript(tmp_path: Path) -> None:
    database_path = tmp_path / "sections.sqlite3"
    config = migration_config(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    command.upgrade(config, "20261020_0016")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    ids = {"user": "10000000000000000000000000000001", "meeting": "20000000000000000000000000000002",
           "transcript": "30000000000000000000000000000003", "version": "40000000000000000000000000000004",
           "segment": "50000000000000000000000000000005", "summary": "60000000000000000000000000000006"}
    try:
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO users (id,email,full_name) VALUES (:user,'legacy-sections@example.com','Old')"), ids)
            connection.execute(text("INSERT INTO meetings (id,owner_id,title,source_type,language_mode,status) VALUES (:meeting,:user,'Old meeting','realtime','vi','completed')"), ids)
            connection.execute(text("INSERT INTO transcripts (id,meeting_id) VALUES (:transcript,:meeting)"), ids)
            connection.execute(text("INSERT INTO transcript_versions (id,transcript_id,version_no,source) VALUES (:version,:transcript,1,'stt')"), ids)
            connection.execute(text("INSERT INTO segment_versions (id,transcript_version_id,logical_segment_id,sequence,start_ms,end_ms,text) VALUES (:segment,:version,:segment,1,0,2000,'Original transcript')"), ids)
            connection.execute(text("UPDATE meetings SET current_transcript_version_id=:version WHERE id=:meeting"), ids)
            connection.execute(text("INSERT INTO summaries (id,meeting_id,transcript_version_id,mode,template_type,output_language) VALUES (:summary,:meeting,:version,'template','general','vi')"), ids)
    finally:
        engine.dispose()
    command.upgrade(config, "head")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.connect() as connection:
            row = connection.execute(text("SELECT sequence,title,start_ms,end_ms,is_started FROM meeting_sections")).one()
            assert tuple(row) == (1, "Phiên 1", 0, 2000, True)
            assert connection.execute(text("SELECT text FROM segment_versions")).scalar_one() == "Original transcript"
            assert connection.execute(text("SELECT scope FROM summaries")).scalar_one() == "meeting"
    finally:
        engine.dispose()
    command.downgrade(config, "20261020_0016")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        assert "meeting_sections" not in inspect(engine).get_table_names()
        assert "scope" not in {item["name"] for item in inspect(engine).get_columns("summaries")}
        with engine.connect() as connection:
            assert connection.execute(text("SELECT text FROM segment_versions")).scalar_one() == "Original transcript"
    finally:
        engine.dispose()


def test_summary_language_migration_backfills_from_meeting(tmp_path: Path) -> None:
    database_path = tmp_path / "summary-language.sqlite3"
    async_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    config = migration_config(async_url)
    command.upgrade(config, "20261005_0009")

    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    identifiers = {
        "user_id": "10000000000000000000000000000001",
        "meeting_id": "20000000000000000000000000000002",
        "transcript_id": "30000000000000000000000000000003",
        "version_id": "40000000000000000000000000000004",
        "summary_id": "50000000000000000000000000000005",
    }
    try:
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO users (id, email, full_name) VALUES (:user_id, 'old@example.com', 'Old User')"),
                identifiers,
            )
            connection.execute(
                text("INSERT INTO meetings (id, owner_id, title, source_type, language_mode) VALUES (:meeting_id, :user_id, 'Old meeting', 'upload', 'en')"),
                identifiers,
            )
            connection.execute(
                text("INSERT INTO transcripts (id, meeting_id) VALUES (:transcript_id, :meeting_id)"),
                identifiers,
            )
            connection.execute(
                text("INSERT INTO transcript_versions (id, transcript_id, version_no, source) VALUES (:version_id, :transcript_id, 1, 'stt')"),
                identifiers,
            )
            connection.execute(
                text("INSERT INTO summaries (id, meeting_id, transcript_version_id, template_type) VALUES (:summary_id, :meeting_id, :version_id, 'general')"),
                identifiers,
            )
    finally:
        engine.dispose()
    command.upgrade(config, "head")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT output_language FROM summaries")).scalar_one() == "en"
    finally:
        engine.dispose()


def test_custom_summary_prompt_migration_backfills_legacy_versions(tmp_path: Path) -> None:
    database_path = tmp_path / "summary-prompt.sqlite3"
    async_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    config = migration_config(async_url)
    command.upgrade(config, "20261012_0013")

    ids = {
        "user_id": "10000000000000000000000000000001",
        "meeting_id": "20000000000000000000000000000002",
        "transcript_id": "30000000000000000000000000000003",
        "transcript_version_id": "40000000000000000000000000000004",
        "summary_id": "50000000000000000000000000000005",
        "summary_version_id": "60000000000000000000000000000006",
        "custom_summary_id": "70000000000000000000000000000007",
        "custom_version_id": "80000000000000000000000000000008",
    }
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO users (id, email, full_name) VALUES (:user_id, 'legacy@example.com', 'Legacy User')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO meetings (id, owner_id, title, source_type, language_mode) VALUES (:meeting_id, :user_id, 'Legacy meeting', 'upload', 'vi')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO transcripts (id, meeting_id) VALUES (:transcript_id, :meeting_id)"),
                ids,
            )
            connection.execute(
                text("INSERT INTO transcript_versions (id, transcript_id, version_no, source) VALUES (:transcript_version_id, :transcript_id, 1, 'stt')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO summaries (id, meeting_id, transcript_version_id, template_type, output_language) VALUES (:summary_id, :meeting_id, :transcript_version_id, 'voting', 'vi')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO summary_versions (id, summary_id, version_no, content, provider, model, created_by) VALUES (:summary_version_id, :summary_id, 1, '{\"overview\": \"Legacy\"}', 'test', 'test', :user_id)"),
                ids,
            )
    finally:
        engine.dispose()

    command.upgrade(config, "20261020_0014")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.begin() as connection:
            assert connection.execute(text("SELECT prompt FROM summary_versions")).scalar_one() == "Tóm tắt cuộc họp biểu quyết."
            connection.execute(
                text("INSERT INTO summaries (id, meeting_id, transcript_version_id, template_type, output_language) VALUES (:custom_summary_id, :meeting_id, :transcript_version_id, 'general', 'vi')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO summary_versions (id, summary_id, version_no, prompt, content, provider, model, created_by) VALUES (:custom_version_id, :custom_summary_id, 1, 'Chỉ nêu các quyết định.', '{\"title\": \"Quyết định\", \"sections\": []}', 'test', 'test', :user_id)"),
                ids,
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.connect() as connection:
            modes = {
                row.id: row.mode
                for row in connection.execute(text("SELECT id, mode FROM summaries"))
            }
            assert modes[ids["summary_id"]] == "template"
            assert modes[ids["custom_summary_id"]] == "custom"
    finally:
        engine.dispose()


def test_speechmatics_migration_discards_mfcc_profiles_and_clears_speakers(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "speechmatics-profile.sqlite3"
    async_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    config = migration_config(async_url)
    command.upgrade(config, "20261008_0011")
    ids = {
        "user_id": "10000000000000000000000000000001",
        "meeting_id": "20000000000000000000000000000002",
        "profile_id": "30000000000000000000000000000003",
        "speaker_id": "40000000000000000000000000000004",
    }
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO users (id, email, full_name) VALUES (:user_id, 'voice@example.com', 'Voice User')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO meetings (id, owner_id, title, source_type, language_mode) VALUES (:meeting_id, :user_id, 'Voice meeting', 'realtime', 'vi')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO voice_profiles (id, user_id, name, embedding) VALUES (:profile_id, :user_id, 'Voice User', '[0.1, 0.2]')"),
                ids,
            )
            connection.execute(
                text("INSERT INTO speakers (id, meeting_id, name, voice_profile_id) VALUES (:speaker_id, :meeting_id, 'Voice User', :profile_id)"),
                ids,
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM voice_profiles")).scalar_one() == 0
            assert connection.execute(text("SELECT voice_profile_id FROM speakers")).scalar_one() is None
    finally:
        engine.dispose()

    command.downgrade(config, "20261008_0011")
    engine = create_engine(f"sqlite+pysqlite:///{database_path.as_posix()}")
    try:
        columns = {item["name"] for item in inspect(engine).get_columns("voice_profiles")}
        assert "embedding" in columns
        assert "speaker_identifiers" not in columns
    finally:
        engine.dispose()
