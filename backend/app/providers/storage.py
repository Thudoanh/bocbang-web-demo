"""Private object-storage boundary for durable media and exports."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Protocol

import httpx
import redis.asyncio as aioredis
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import Settings


class StorageError(Exception):
    """A storage operation failed without exposing provider credentials."""


class StorageNotFoundError(StorageError):
    """The requested object does not exist."""


class StorageBackend(Protocol):
    async def put_file(self, source: Path, key: str) -> None: ...
    async def delete(self, key: str) -> None: ...
    async def delete_many(self, keys: list[str]) -> None: ...
    async def put_bytes(self, content: bytes, key: str) -> None: ...
    async def get_bytes(self, key: str) -> bytes: ...
    async def get_range(self, key: str, start: int, end: int) -> bytes: ...
    async def download_file(self, key: str, destination: Path) -> None: ...
    async def presigned_get_url(self, key: str, expires_in: int, *, content_type: str | None = None, content_disposition: str | None = None) -> str | None: ...


# Compatibility alias for existing service imports.
MediaStorage = StorageBackend


class LocalStorageBackend:
    """Stores opaque object keys below one configured local development root."""

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

    async def delete_many(self, keys: list[str]) -> None:
        if not keys:
            return
        await asyncio.gather(*(self.delete(k) for k in keys), return_exceptions=True)

    async def put_bytes(self, content: bytes, key: str) -> None:
        destination = self._path_for(key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(destination.write_bytes, content)

    async def get_bytes(self, key: str) -> bytes:
        try:
            return await asyncio.to_thread(self._path_for(key).read_bytes)
        except FileNotFoundError as exc:
            raise StorageNotFoundError("Object was not found.") from exc

    async def get_range(self, key: str, start: int, end: int) -> bytes:
        path = self._path_for(key)
        def read() -> bytes:
            with path.open("rb") as source:
                source.seek(start)
                return source.read(end - start + 1)
        try:
            return await asyncio.to_thread(read)
        except FileNotFoundError as exc:
            raise StorageNotFoundError("Object was not found.") from exc

    async def download_file(self, key: str, destination: Path) -> None:
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        try:
            await asyncio.to_thread(shutil.copyfile, self._path_for(key), destination)
        except FileNotFoundError as exc:
            raise StorageNotFoundError("Object was not found.") from exc

    async def presigned_get_url(self, key: str, expires_in: int, **_: object) -> str | None:
        return None

    def _path_for(self, key: str) -> Path:
        candidate = (self._root / key).resolve()
        if self._root != candidate and self._root not in candidate.parents:
            raise StorageError("Storage key resolves outside the configured media root.")
        return candidate


class S3StorageBackend:
    """Synchronous boto3 client isolated behind async application operations."""

    def __init__(self, *, endpoint_url: str | None, access_key_id: str, secret_access_key: str, bucket_name: str, region: str) -> None:
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("boto3 is required when STORAGE_BACKEND=s3.") from exc
        self._bucket_name = bucket_name
        self._client = boto3.client("s3", endpoint_url=endpoint_url, aws_access_key_id=access_key_id, aws_secret_access_key=secret_access_key, region_name=region)

    async def put_file(self, source: Path, key: str) -> None:
        await self._call(self._client.upload_file, str(source), self._bucket_name, key)

    async def delete(self, key: str) -> None:
        await self._call(self._client.delete_object, Bucket=self._bucket_name, Key=key)

    async def delete_many(self, keys: list[str]) -> None:
        if not keys:
            return
        for i in range(0, len(keys), 1000):
            chunk = keys[i : i + 1000]
            await self._call(
                self._client.delete_objects,
                Bucket=self._bucket_name,
                Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
            )

    async def put_bytes(self, content: bytes, key: str) -> None:
        await self._call(self._client.put_object, Bucket=self._bucket_name, Key=key, Body=content)

    async def get_bytes(self, key: str) -> bytes:
        response = await self._call(self._client.get_object, Bucket=self._bucket_name, Key=key)
        return await asyncio.to_thread(response["Body"].read)

    async def get_range(self, key: str, start: int, end: int) -> bytes:
        response = await self._call(self._client.get_object, Bucket=self._bucket_name, Key=key, Range=f"bytes={start}-{end}")
        return await asyncio.to_thread(response["Body"].read)

    async def download_file(self, key: str, destination: Path) -> None:
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await self._call(self._client.download_file, self._bucket_name, key, str(destination))

    async def presigned_get_url(self, key: str, expires_in: int, *, content_type: str | None = None, content_disposition: str | None = None) -> str:
        parameters: dict[str, str] = {"Bucket": self._bucket_name, "Key": key}
        if content_type:
            parameters["ResponseContentType"] = content_type
        if content_disposition:
            parameters["ResponseContentDisposition"] = content_disposition
        return await self._call(self._client.generate_presigned_url, "get_object", Params=parameters, ExpiresIn=expires_in)

    async def _call(self, function: object, /, *args: object, **kwargs: object):
        try:
            return await asyncio.to_thread(function, *args, **kwargs)  # type: ignore[arg-type]
        except Exception as exc:
            code = _client_error_code(exc)
            if code in {"404", "NoSuchKey", "NoSuchBucket", "NotFound"}:
                raise StorageNotFoundError("Object was not found.") from exc
            raise StorageError("S3-compatible storage operation failed.") from exc


class DatabaseStorageBackend:
    """Stores binary media objects in PostgreSQL for durable persistence across container restarts."""

    def __init__(self, database_url: str, local_root: Path | None = None) -> None:
        connect_args = {
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "command_timeout": 60,
        }
        self._engine: AsyncEngine = create_async_engine(
            database_url,
            pool_pre_ping=False,
            connect_args=connect_args,
        )
        self._local_root: Path | None = local_root.resolve() if local_root else None

    async def put_file(self, source: Path, key: str) -> None:
        content = await asyncio.to_thread(source.read_bytes)
        await self.put_bytes(content, key)

    async def put_bytes(self, content: bytes, key: str) -> None:
        query = text(
            """
            INSERT INTO storage_blobs (storage_key, data, size_bytes)
            VALUES (:key, :data, :size)
            ON CONFLICT (storage_key) DO UPDATE
            SET data = EXCLUDED.data,
                size_bytes = EXCLUDED.size_bytes,
                updated_at = NOW()
            """
        )
        try:
            async with self._engine.begin() as conn:
                await conn.execute(query, {"key": key, "data": content, "size": len(content)})
        except Exception as exc:
            raise StorageError("Database storage put operation failed.") from exc

        if self._local_root:
            dest = self._local_root / key
            try:
                await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(dest.write_bytes, content)
            except OSError:
                pass

    async def get_bytes(self, key: str) -> bytes:
        if self._local_root:
            local_path = self._local_root / key
            if local_path.is_file():
                try:
                    return await asyncio.to_thread(local_path.read_bytes)
                except OSError:
                    pass
        query = text("SELECT data FROM storage_blobs WHERE storage_key = :key")
        try:
            async with self._engine.connect() as conn:
                result = await conn.execute(query, {"key": key})
                data = result.scalar()
                if data is None:
                    raise StorageNotFoundError("Object was not found.")
                result_bytes = bytes(data)
                if self._local_root:
                    dest = self._local_root / key
                    if not dest.is_file():
                        async def _cache_full(d: Path, k: str):
                            try:
                                full_data = await self.get_bytes(k)
                                await asyncio.to_thread(d.parent.mkdir, parents=True, exist_ok=True)
                                await asyncio.to_thread(d.write_bytes, full_data)
                            except Exception:
                                pass
                        asyncio.create_task(_cache_full(dest, key))
                return result_bytes
        except StorageNotFoundError:
            raise
        except Exception as exc:
            raise StorageError("Database storage read operation failed.") from exc

    async def get_range(self, key: str, start: int, end: int) -> bytes:
        if self._local_root:
            local_path = self._local_root / key
            if local_path.is_file():
                try:
                    def read() -> bytes:
                        with local_path.open("rb") as s:
                            s.seek(start)
                            return s.read(end - start + 1)
                    return await asyncio.to_thread(read)
                except OSError:
                    pass
        length = max(0, end - start + 1)
        query = text(
            "SELECT substring(data FROM :start_pos FOR :length) FROM storage_blobs WHERE storage_key = :key"
        )
        try:
            async with self._engine.connect() as conn:
                result = await conn.execute(
                    query, {"key": key, "start_pos": start + 1, "length": length}
                )
                data = result.scalar()
                if data is None:
                    raise StorageNotFoundError("Object was not found.")
                result_bytes = bytes(data)
                if self._local_root:
                    dest = self._local_root / key
                    if not dest.is_file():
                        async def _cache_full(d: Path, k: str):
                            try:
                                full_data = await self.get_bytes(k)
                                await asyncio.to_thread(d.parent.mkdir, parents=True, exist_ok=True)
                                await asyncio.to_thread(d.write_bytes, full_data)
                            except Exception:
                                pass
                        asyncio.create_task(_cache_full(dest, key))
                return result_bytes
        except StorageNotFoundError:
            raise
        except Exception as exc:
            raise StorageError("Database storage range operation failed.") from exc

    async def download_file(self, key: str, destination: Path) -> None:
        data = await self.get_bytes(key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(destination.write_bytes, data)

    async def delete(self, key: str) -> None:
        await self.delete_many([key])

    async def delete_many(self, keys: list[str]) -> None:
        if not keys:
            return
        from sqlalchemy import delete
        from app.models.media import StorageBlob

        stmt = delete(StorageBlob).where(StorageBlob.storage_key.in_(keys))
        try:
            async with self._engine.begin() as conn:
                await conn.execute(stmt)
        except Exception as exc:
            raise StorageError("Database storage delete operation failed.") from exc

        if self._local_root:
            for key in keys:
                local_path = self._local_root / key
                if local_path.exists():
                    try:
                        await asyncio.to_thread(local_path.unlink)
                    except OSError:
                        pass

    async def presigned_get_url(self, key: str, expires_in: int, **_: object) -> str | None:
        return None

    async def dispose(self) -> None:
        await self._engine.dispose()




class SeaweedStorageBackend:
    """Stores binary objects in SeaweedFS with metadata stored in Redis or memory."""

    def __init__(
        self,
        master_url: str = "http://103.163.215.105:9333",
        database_url: str | None = None,
        redis_url: str | None = None,
        local_root: Path | None = None,
        public_url: str | None = "https://media3.h2qsolution.com",
        collection: str = "bocbang",
    ) -> None:
        self._master_url = master_url.rstrip("/")
        self._public_url = public_url.rstrip("/") if public_url else None
        self._collection = collection
        self._local_root: Path | None = local_root.resolve() if local_root else None
        self._volume_cache: dict[str, str] = {}
        self._memory_index: dict[str, str] = {}
        self._client: httpx.AsyncClient | None = None
        self._redis_url = redis_url
        self._redis: aioredis.Redis | None = None
        if redis_url:
            try:
                self._redis = aioredis.from_url(redis_url, protocol=2)
            except Exception:
                self._redis = None

        if database_url:
            connect_args = {
                "statement_cache_size": 0,
                "prepared_statement_cache_size": 0,
                "command_timeout": 60,
            }
            self._engine: AsyncEngine | None = create_async_engine(
                database_url,
                pool_pre_ping=False,
                connect_args=connect_args,
            )
        else:
            self._engine = None

    def _redis_key(self, key: str) -> str:
        return f"bocbang:seaweed:{key}"

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    async def _assign(self) -> tuple[str, str]:
        """Request fid and volume url from SeaweedFS master."""
        client = self._get_client()
        url = f"{self._master_url}/dir/assign"
        if self._collection:
            url += f"?collection={self._collection}"
        try:
            res = await client.get(url)
            res.raise_for_status()
            data = res.json()
            fid = data["fid"]
            vol_url = data["url"]
            vol_id = fid.split(",")[0]
            self._volume_cache[vol_id] = vol_url
            return fid, vol_url
        except Exception as exc:
            raise StorageError(f"Failed to assign volume from SeaweedFS master: {exc}") from exc

    async def _lookup_volume_url(self, fid: str) -> str:
        vol_id = fid.split(",")[0]
        if vol_id in self._volume_cache:
            return self._volume_cache[vol_id]
        client = self._get_client()
        try:
            res = await client.get(f"{self._master_url}/dir/lookup?volumeId={vol_id}")
            res.raise_for_status()
            data = res.json()
            locations = data.get("locations", [])
            if not locations:
                raise StorageNotFoundError(f"No volume locations for volume {vol_id}")
            url = locations[0]["url"]
            self._volume_cache[vol_id] = url
            return url
        except StorageNotFoundError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to lookup volume {vol_id} from SeaweedFS master: {exc}") from exc

    async def put_file(self, source: Path, key: str) -> None:
        content = await asyncio.to_thread(source.read_bytes)
        await self.put_bytes(content, key)

    async def put_bytes(self, content: bytes, key: str) -> None:
        client = self._get_client()
        fid, vol_url = await self._assign()
        old_fid = await self._get_existing_fid(key)

        try:
            upload_url = f"http://{vol_url}/{fid}"
            res = await client.put(
                upload_url,
                content=content,
                headers={"Content-Type": "application/octet-stream"},
            )
            res.raise_for_status()
        except Exception as exc:
            raise StorageError(f"SeaweedFS upload failed: {exc}") from exc

        # Save mapping to Redis
        if self._redis:
            try:
                await self._redis.set(self._redis_key(key), fid)
            except Exception as exc:
                raise StorageError(f"Redis storage index put failed: {exc}") from exc
        else:
            self._memory_index[key] = fid

        # Optional database sync (keep storage_blobs in sync if engine is configured, without failing)
        if self._engine:
            blob_marker = f"seaweed:{fid}".encode("utf-8")
            query = text(
                """
                INSERT INTO storage_blobs (storage_key, data, size_bytes)
                VALUES (:key, :data, :size)
                ON CONFLICT (storage_key) DO UPDATE
                SET data = EXCLUDED.data,
                    size_bytes = EXCLUDED.size_bytes,
                    updated_at = NOW()
                """
            )
            try:
                async with self._engine.begin() as conn:
                    await conn.execute(query, {"key": key, "data": blob_marker, "size": len(content)})
            except Exception:
                pass

        if old_fid and old_fid != fid:
            asyncio.create_task(self._safe_delete_fid(old_fid))

        if self._local_root:
            dest = self._local_root / key
            try:
                await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(dest.write_bytes, content)
            except OSError:
                pass

    async def _get_existing_fid(self, key: str) -> str | None:
        try:
            fid, _ = await self._get_blob_info(key)
            return fid
        except Exception:
            return None

    async def _get_blob_info(self, key: str) -> tuple[str | None, bytes | None]:
        # 1. Memory index check
        if key in self._memory_index:
            return self._memory_index[key], None

        # 2. Redis check
        if self._redis:
            try:
                val = await self._redis.get(self._redis_key(key))
                if val:
                    fid = val.decode("utf-8") if isinstance(val, bytes) else str(val)
                    return fid, None
            except Exception:
                pass

        # 3. Database check
        if self._engine:
            query = text("SELECT data FROM storage_blobs WHERE storage_key = :key")
            try:
                async with self._engine.connect() as conn:
                    result = await conn.execute(query, {"key": key})
                    data = result.scalar()
                    if data is not None:
                        raw = bytes(data)
                        if raw.startswith(b"seaweed:"):
                            fid = raw[8:].decode("utf-8")
                            if self._redis:
                                try:
                                    await self._redis.set(self._redis_key(key), fid)
                                except Exception:
                                    pass
                            return fid, None
                        return None, raw
            except Exception:
                pass

        raise StorageNotFoundError("Object was not found.")

    async def get_bytes(self, key: str) -> bytes:
        if self._local_root:
            local_path = self._local_root / key
            if local_path.is_file():
                try:
                    return await asyncio.to_thread(local_path.read_bytes)
                except OSError:
                    pass

        fid, raw_data = await self._get_blob_info(key)
        if raw_data is not None:
            return raw_data

        assert fid is not None
        vol_url = await self._lookup_volume_url(fid)
        client = self._get_client()
        try:
            res = await client.get(f"http://{vol_url}/{fid}", headers={"Accept-Encoding": "identity"})
            if res.status_code == 404:
                raise StorageNotFoundError("Object was not found.")
            res.raise_for_status()
            content = res.content
        except StorageNotFoundError:
            raise
        except Exception as exc:
            raise StorageError(f"SeaweedFS get_bytes failed: {exc}") from exc

        if self._local_root:
            dest = self._local_root / key
            try:
                await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(dest.write_bytes, content)
            except OSError:
                pass
        return content

    async def get_range(self, key: str, start: int, end: int) -> bytes:
        if self._local_root:
            local_path = self._local_root / key
            if local_path.is_file():
                try:
                    def read() -> bytes:
                        with local_path.open("rb") as s:
                            s.seek(start)
                            return s.read(end - start + 1)
                    return await asyncio.to_thread(read)
                except OSError:
                    pass

        fid, raw_data = await self._get_blob_info(key)
        if raw_data is not None:
            return raw_data[start : end + 1]

        assert fid is not None
        vol_url = await self._lookup_volume_url(fid)
        client = self._get_client()
        try:
            res = await client.get(
                f"http://{vol_url}/{fid}",
                headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"},
            )
            if res.status_code == 404:
                raise StorageNotFoundError("Object was not found.")
            res.raise_for_status()
            return res.content
        except StorageNotFoundError:
            raise
        except Exception as exc:
            raise StorageError(f"SeaweedFS get_range failed: {exc}") from exc

    async def download_file(self, key: str, destination: Path) -> None:
        data = await self.get_bytes(key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(destination.write_bytes, data)

    async def delete(self, key: str) -> None:
        await self.delete_many([key])

    async def delete_many(self, keys: list[str]) -> None:
        if not keys:
            return

        fids_to_delete: list[str] = []

        for k in keys:
            fid = self._memory_index.pop(k, None)
            if fid:
                fids_to_delete.append(fid)

        if self._redis:
            try:
                redis_keys = [self._redis_key(k) for k in keys]
                vals = await self._redis.mget(redis_keys)
                for val in vals:
                    if val:
                        fid = val.decode("utf-8") if isinstance(val, bytes) else str(val)
                        if fid not in fids_to_delete:
                            fids_to_delete.append(fid)
                await self._redis.delete(*redis_keys)
            except Exception:
                pass

        if self._engine:
            from app.models.media import StorageBlob
            stmt_select = select(StorageBlob.data).where(StorageBlob.storage_key.in_(keys))
            stmt_delete = delete(StorageBlob).where(StorageBlob.storage_key.in_(keys))
            try:
                async with self._engine.begin() as conn:
                    result = await conn.execute(stmt_select)
                    for row in result:
                        raw = bytes(row[0])
                        if raw.startswith(b"seaweed:"):
                            fid = raw[8:].decode("utf-8")
                            if fid not in fids_to_delete:
                                fids_to_delete.append(fid)
                    await conn.execute(stmt_delete)
            except Exception:
                pass

        if self._local_root:
            for key in keys:
                local_path = self._local_root / key
                if local_path.exists():
                    try:
                        await asyncio.to_thread(local_path.unlink)
                    except OSError:
                        pass

        for fid in fids_to_delete:
            await self._safe_delete_fid(fid)

    async def _safe_delete_fid(self, fid: str) -> None:
        try:
            vol_url = await self._lookup_volume_url(fid)
            client = self._get_client()
            await client.delete(f"http://{vol_url}/{fid}")
        except Exception:
            pass

    async def presigned_get_url(
        self,
        key: str,
        expires_in: int,
        *,
        content_type: str | None = None,
        content_disposition: str | None = None,
    ) -> str | None:
        try:
            fid, _ = await self._get_blob_info(key)
        except Exception:
            return None
        if not fid:
            return None
        if self._public_url:
            return f"{self._public_url}/{fid}"
        try:
            vol_url = await self._lookup_volume_url(fid)
            return f"http://{vol_url}/{fid}"
        except Exception:
            return None

    async def dispose(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
        if self._redis:
            try:
                await self._redis.aclose()
            except Exception:
                pass
        if self._engine:
            await self._engine.dispose()


def build_storage_backend(settings: Settings) -> StorageBackend:
    if settings.storage_backend in {"s3", "s3-compatible"}:
        missing = [
            name
            for name, value in {
                "S3_ACCESS_KEY_ID": settings.s3_access_key_id,
                "S3_SECRET_ACCESS_KEY": settings.s3_secret_access_key,
                "S3_BUCKET_NAME": settings.s3_bucket_name,
            }.items()
            if not value
        ]
        if missing:
            raise ValueError("STORAGE_BACKEND=s3 requires " + ", ".join(missing) + ".")
        return S3StorageBackend(
            endpoint_url=settings.s3_endpoint_url,
            access_key_id=settings.s3_access_key_id,
            secret_access_key=settings.s3_secret_access_key,
            bucket_name=settings.s3_bucket_name,
            region=settings.s3_region,
        )
    if settings.storage_backend in {"seaweed", "seaweedfs"}:
        return SeaweedStorageBackend(
            master_url=settings.seaweed_master_url,
            database_url=settings.database_url,
            redis_url=settings.seaweed_redis_url,
            local_root=settings.media_storage_path,
            public_url=settings.seaweed_public_url,
            collection=settings.seaweed_collection,
        )
    if settings.database_url and (
        settings.storage_backend in {"database", "postgres", "db"}
        or settings.environment.lower() in {"production", "prod"}
    ):
        return DatabaseStorageBackend(settings.database_url, settings.media_storage_path)
    return LocalStorageBackend(settings.media_storage_path)


def _client_error_code(error: Exception) -> str | None:
    response = getattr(error, "response", None)
    details = response.get("Error") if isinstance(response, dict) else None
    return str(details.get("Code")) if isinstance(details, dict) and details.get("Code") else None


FileSystemMediaStorage = LocalStorageBackend
