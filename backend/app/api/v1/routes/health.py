from fastapi import APIRouter, Request, Response, status

from app.core.dependencies import get_database
from app.db.session import Database
from app.schemas.health import HealthResponse, ReadinessResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, summary="Liveness check")
async def health() -> HealthResponse:
    """Report whether the API process can serve requests."""
    return HealthResponse(status="ok")


@router.get("/ready", response_model=ReadinessResponse, summary="Readiness check")
async def readiness(request: Request, response: Response) -> ReadinessResponse:
    """Report whether configured runtime dependencies are reachable."""
    database: Database = get_database(request)
    if not database.is_configured:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return ReadinessResponse(status="not_ready", checks={"database": "not_configured"})

    if not await database.ping():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return ReadinessResponse(status="not_ready", checks={"database": "unavailable"})

    return ReadinessResponse(status="ready", checks={"database": "ok"})
