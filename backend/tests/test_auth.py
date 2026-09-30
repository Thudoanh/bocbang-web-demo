import asyncio
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.db.base import Base
from app.main import create_app


class CapturingEmailSender:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str, str]] = []

    async def send_otp(self, recipient: str, code: str, purpose: str) -> None:
        self.messages.append((recipient, code, purpose))


def test_email_registration_verification_login_and_refresh(tmp_path: Path) -> None:
    async def create_schema(database_url: str) -> None:
        engine = create_async_engine(database_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await engine.dispose()

    database_url = f"sqlite+aiosqlite:///{(tmp_path / 'auth.sqlite3').as_posix()}"
    asyncio.run(create_schema(database_url))
    sender = CapturingEmailSender()
    app = create_app(
        Settings(
            _env_file=None,
            database_url=database_url,
            jwt_secret="test-secret",
            frontend_origins="http://localhost:5173",
        )
    )
    app.state.email_sender = sender

    with TestClient(app) as client:
        registration = client.post(
            "/api/v1/auth/register",
            json={
                "email": "member@example.com",
                "password": "correct horse battery",
                "full_name": "Member",
            },
        )
        assert registration.status_code == 201
        assert registration.json()["user"]["is_email_verified"] is False
        assert sender.messages[0][0] == "member@example.com"
        assert sender.messages[0][2] == "verify_email"

        unverified_login = client.post(
            "/api/v1/auth/login",
            json={"email": "member@example.com", "password": "correct horse battery"},
        )
        assert unverified_login.status_code == 403
        assert unverified_login.json()["code"] == "EMAIL_NOT_VERIFIED"

        verified = client.post(
            "/api/v1/auth/verify-email-otp",
            json={"email": "member@example.com", "code": sender.messages[0][1]},
        )
        assert verified.status_code == 200
        session = verified.json()
        assert session["access_token"]
        assert session["refresh_token"]
        assert session["user"]["is_email_verified"] is True

        profile = client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"}
        )
        assert profile.status_code == 200
        assert profile.json()["email"] == "member@example.com"

        refreshed = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
        )
        assert refreshed.status_code == 200
        assert refreshed.json()["access_token"] != session["access_token"]


def test_google_start_requires_configuration_and_uses_signed_state(tmp_path: Path) -> None:
    database_url = f"sqlite+aiosqlite:///{(tmp_path / 'google.sqlite3').as_posix()}"
    app = create_app(
        Settings(
            _env_file=None,
            database_url=database_url,
            jwt_secret="test-secret",
            frontend_origins="http://localhost:5173",
            google_client_id="client-id",
            google_client_secret="client-secret",
            google_redirect_uri="http://localhost:8000/api/v1/auth/google/callback",
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/auth/google/start", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "bocbang_oauth_state" in response.headers["set-cookie"]
