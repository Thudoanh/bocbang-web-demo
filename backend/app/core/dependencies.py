from typing import cast

from fastapi import Request

from app.core.config import Settings
from app.db.session import Database


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_database(request: Request) -> Database:
    return cast(Database, request.app.state.database)
