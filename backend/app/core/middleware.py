from collections.abc import Awaitable, Callable
from contextvars import ContextVar
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.logging import get_logger

logger = get_logger(__name__)
request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach an opaque request id and emit one structured access log per request."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        context_token = request_id_context.set(request_id)
        started_at = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            response.headers["X-Process-Time-Ms"] = str(duration_ms)
            logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                },
            )
            return response
        finally:
            request_id_context.reset(context_token)
