from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.session import Database


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_database(request: Request) -> Database:
    return cast(Database, request.app.state.database)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield one dependency-cached database session for the current request."""
    async with get_database(request).session() as session:
        yield session


DatabaseSessionDependency = Annotated[AsyncSession, Depends(get_session)]
