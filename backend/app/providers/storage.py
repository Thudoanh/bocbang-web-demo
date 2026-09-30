"""Storage boundary with a local filesystem adapter for development and tests."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Protocol


class MediaStorage(Protocol):
    async def put_file(self, source: Path, key: str) -> None: ...

    async def delete(self, key: str) -> None: ...

    async def put_bytes(self, content: bytes, key: str) -> None: ...

    async def get_bytes(self, key: str) -> bytes: ...


class FileSystemMediaStorage:
    """Stores opaque object keys below one configured directory.

    The adapter intentionally exposes no URL semantics; production can replace it
    with an S3-compatible implementation without changing media use cases.
    """

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    async def put_file(self, source: Path, key: str) -> None:
        destination = self._path_for(key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, source, destination)

    async def delete(self, key: str) -> None:
        path = self._path_for(key)
        if path.exists():
            await asyncio.to_thread(path.unlink)

    async def put_bytes(self, content: bytes, key: str) -> None:
        destination = self._path_for(key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(destination.write_bytes, content)

    async def get_bytes(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path_for(key).read_bytes)

    def _path_for(self, key: str) -> Path:
        candidate = (self._root / key).resolve()
        if self._root != candidate and self._root not in candidate.parents:
            raise ValueError("Storage key resolves outside the configured media root.")
        return candidate
