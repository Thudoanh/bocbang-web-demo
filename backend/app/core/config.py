"""Environment-backed application settings."""

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
API_V1_PREFIX = "/api/v1"


class Settings(BaseSettings):
    """Runtime configuration with safe local defaults and no embedded secrets."""

    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "Bóc Băng AI API"
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("APP_ENVIRONMENT", "ENVIRONMENT"),
    )
    log_level: str = "INFO"
    frontend_origins: tuple[str, ...] = Field(
        default=("http://localhost:5173",),
        validation_alias=AliasChoices("FRONTEND_ORIGINS", "FRONTEND_ORIGIN"),
    )
    database_url: str | None = None
    redis_url: str | None = None
    jwt_secret: str | None = None
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 2_592_000
    email_otp_ttl_seconds: int = 600
    email_otp_max_attempts: int = 5
    email_provider: str | None = None
    email_api_key: str | None = None
    email_from: str | None = None
    email_smtp_host: str | None = None
    email_smtp_port: int = 587
    email_smtp_username: str | None = None
    email_smtp_password: str | None = None
    email_smtp_use_tls: bool = True
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str | None = None
    max_upload_bytes: int = 524_288_000
    max_media_duration_seconds: int = 7_200
    media_storage_path: Path = REPOSITORY_ROOT / ".local-media"
    stt_provider: str | None = None
    stt_api_key: str | None = None
    translation_provider: str | None = None
    translation_api_key: str | None = None
    llm_provider: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None

    @field_validator("frontend_origins", mode="before")
    @classmethod
    def split_frontend_origins(cls, value: str | list[str] | tuple[str, ...]) -> tuple[str, ...]:
        if isinstance(value, str):
            origins = tuple(origin.strip().rstrip("/") for origin in value.split(",") if origin.strip())
        else:
            origins = tuple(str(origin).strip().rstrip("/") for origin in value if str(origin).strip())
        if not origins:
            raise ValueError("At least one FRONTEND_ORIGIN must be configured.")
        return origins

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str | None) -> str | None:
        if not value:
            return None
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value.removeprefix("postgres://")
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value.removeprefix("postgresql://")
        return value


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings object."""
    return Settings()
