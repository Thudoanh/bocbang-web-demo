"""Dramatiq bootstrap. Run with: dramatiq app.workers.worker"""

from app.workers.broker import ensure_broker

ensure_broker()
from app.workers.tasks import execute_job  # noqa: E402, F401
