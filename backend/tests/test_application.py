from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def build_client() -> TestClient:
    settings = Settings(
        _env_file=None,
        frontend_origins="http://localhost:5173",
        database_url=None,
    )
    return TestClient(create_app(settings))


def test_application_starts_and_generates_openapi() -> None:
    with build_client() as client:
        response = client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    assert "/api/v1/health" in response.json()["paths"]


def test_neon_database_url_is_compatible_with_asyncpg() -> None:
    settings = Settings(
        _env_file=None,
        database_url=(
            "postgresql://user:password@example.neon.tech/database"
            "?sslmode=require&channel_binding=require"
        ),
    )

    assert settings.database_url == (
        "postgresql+asyncpg://user:password@example.neon.tech/database?ssl=require"
    )


def test_health_is_live_and_returns_request_id() -> None:
    with build_client() as client:
        response = client.get("/api/v1/health", headers={"X-Request-ID": "test-request"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"] == "test-request"


def test_readiness_is_not_ready_without_database_configuration() -> None:
    with build_client() as client:
        response = client.get("/api/v1/ready")

    assert response.status_code == 503
    assert response.json()["checks"] == {"database": "not_configured"}


def test_unknown_api_route_uses_structured_error_response() -> None:
    with build_client() as client:
        response = client.get("/api/v1/does-not-exist")

    body = response.json()
    assert response.status_code == 404
    assert body["code"] == "NOT_FOUND"
    assert body["message"] == "Not Found"
    assert body["request_id"] == response.headers["X-Request-ID"]


def test_request_validation_uses_structured_error_response() -> None:
    app: FastAPI = create_app(Settings(_env_file=None, database_url=None))

    @app.get("/api/v1/test-validation")
    async def validate(value: int) -> dict[str, int]:
        return {"value": value}

    with TestClient(app) as client:
        response = client.get("/api/v1/test-validation", params={"value": "invalid"})

    body = response.json()
    assert response.status_code == 422
    assert body["code"] == "VALIDATION_ERROR"
    assert body["details"]["errors"]
