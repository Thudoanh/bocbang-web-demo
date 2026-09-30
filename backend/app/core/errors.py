"""Stable, frontend-friendly API error responses."""

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.error import ErrorResponse

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """An intentional API error with a stable code and HTTP status."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


def _error_response(request: Request, error: ErrorResponse, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(error.model_dump(exclude_none=True)),
        headers={"X-Request-ID": request.state.request_id},
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(
            request,
            ErrorResponse(
                code=exc.code,
                message=exc.message,
                request_id=request.state.request_id,
                details=exc.details,
            ),
            exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return _error_response(
            request,
            ErrorResponse(
                code="VALIDATION_ERROR",
                message="Request validation failed.",
                request_id=request.state.request_id,
                details={"errors": exc.errors()},
            ),
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    @app.exception_handler(ValidationError)
    async def handle_validation_error(request: Request, exc: ValidationError) -> JSONResponse:
        logger.warning("response_validation_error", exc_info=exc)
        return _error_response(
            request,
            ErrorResponse(
                code="INTERNAL_SERVER_ERROR",
                message="An internal server error occurred.",
                request_id=request.state.request_id,
            ),
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    @app.exception_handler(HTTPException)
    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(
        request: Request, exc: HTTPException | StarletteHTTPException
    ) -> JSONResponse:
        error_code = "NOT_FOUND" if exc.status_code == status.HTTP_404_NOT_FOUND else "HTTP_ERROR"
        message = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
        return _error_response(
            request,
            ErrorResponse(code=error_code, message=message, request_id=request.state.request_id),
            exc.status_code,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_exception", exc_info=exc)
        return _error_response(
            request,
            ErrorResponse(
                code="INTERNAL_SERVER_ERROR",
                message="An internal server error occurred.",
                request_id=request.state.request_id,
            ),
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
