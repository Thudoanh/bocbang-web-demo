"""Async SQLAlchemy connection and session lifecycle."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


class Database:
    """Lazy database resource that keeps application startup independent of network availability."""

    def __init__(self, database_url: str | None) -> None:
        self._engine: AsyncEngine | None = (
            create_async_engine(database_url, pool_pre_ping=True) if database_url else None
        )
        self._session_factory = (
            async_sessionmaker(self._engine, expire_on_commit=False) if self._engine else None
        )

    @property
    def is_configured(self) -> bool:
        return self._engine is not None

    async def ping(self) -> bool:
        if self._engine is None:
            return False
        try:
            async with self._engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception:
            return False
        return True

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        if self._session_factory is None:
            raise RuntimeError("Database is not configured.")
        async with self._session_factory() as session:
            yield session

    async def dispose(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()
