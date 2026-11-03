from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared ORM metadata for the application's domain models."""


# Import every mapped class after Base is defined so Alembic sees a complete
# metadata graph without individual migration commands needing model imports.
from app import models  # noqa: E402, F401
