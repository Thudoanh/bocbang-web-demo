import asyncio
from pathlib import Path

import pytest

from app.core.config import Settings
from app.providers.storage import LocalStorageBackend, S3StorageBackend, SeaweedStorageBackend, StorageError, StorageNotFoundError, build_storage_backend


def test_local_storage_put_read_download_and_delete(tmp_path: Path) -> None:
    async def run() -> None:
        storage = LocalStorageBackend(tmp_path / "objects")
        source = tmp_path / "source.bin"
        source.write_bytes(b"abcdef")
        await storage.put_file(source, "media/meetings/a/source.bin")
        assert await storage.get_bytes("media/meetings/a/source.bin") == b"abcdef"
        assert await storage.get_range("media/meetings/a/source.bin", 1, 3) == b"bcd"
        destination = tmp_path / "download.bin"
        await storage.download_file("media/meetings/a/source.bin", destination)
        assert destination.read_bytes() == b"abcdef"
        await storage.delete("media/meetings/a/source.bin")
        with pytest.raises(StorageError):
            await storage.get_bytes("media/meetings/a/source.bin")
    asyncio.run(run())


def test_storage_factory_selects_local_and_rejects_incomplete_s3(tmp_path: Path) -> None:
    assert isinstance(build_storage_backend(Settings(_env_file=None, media_storage_path=tmp_path)), LocalStorageBackend)
    with pytest.raises(ValueError, match="S3_ACCESS_KEY_ID"):
        build_storage_backend(Settings(_env_file=None, storage_backend="s3"))


def test_s3_adapter_uses_bucket_key_and_presigned_url() -> None:
    class Client:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []

        def put_object(self, *args: object, **kwargs: object) -> None:
            self.calls.append(("put_object", args, kwargs))

        def upload_file(self, *args: object, **kwargs: object) -> None:
            self.calls.append(("upload_file", args, kwargs))

        def delete_object(self, *args: object, **kwargs: object) -> None:
            self.calls.append(("delete_object", args, kwargs))

        def generate_presigned_url(self, *args: object, **kwargs: object) -> str:
            self.calls.append(("generate_presigned_url", args, kwargs))
            return "https://storage.example/signed"

    backend = S3StorageBackend.__new__(S3StorageBackend)
    backend._bucket_name = "private-bucket"
    backend._client = Client()

    source = Path("input.wav")

    async def run() -> None:
        await backend.put_file(source, "media/meetings/a/input.wav")
        await backend.put_bytes(b"body", "exports/meetings/a/file.txt")
        await backend.delete("exports/meetings/a/file.txt")
        assert await backend.presigned_get_url("exports/meetings/a/file.txt", 60) == "https://storage.example/signed"

    asyncio.run(run())
    calls = backend._client.calls
    assert calls[0][1] == ("input.wav", "private-bucket", "media/meetings/a/input.wav")
    assert calls[1][2] == {"Bucket": "private-bucket", "Key": "exports/meetings/a/file.txt", "Body": b"body"}
    assert calls[2][2] == {"Bucket": "private-bucket", "Key": "exports/meetings/a/file.txt"}
    assert calls[3][1] == ("get_object",)
    assert calls[3][2]["Params"] == {"Bucket": "private-bucket", "Key": "exports/meetings/a/file.txt"}


def test_s3_adapter_propagates_client_failure() -> None:
    class Client:
        def delete_object(self, **_: object) -> None:
            raise RuntimeError("connection failed")

    backend = S3StorageBackend.__new__(S3StorageBackend)
    backend._bucket_name = "private-bucket"
    backend._client = Client()

    with pytest.raises(StorageError, match="S3-compatible storage operation failed"):
        asyncio.run(backend.delete("media/meetings/a/file.mp3"))


def test_local_storage_delete_many(tmp_path: Path) -> None:
    async def run() -> None:
        storage = LocalStorageBackend(tmp_path / "objects")
        await storage.put_bytes(b"123", "item1.txt")
        await storage.put_bytes(b"456", "item2.txt")
        assert await storage.get_bytes("item1.txt") == b"123"
        assert await storage.get_bytes("item2.txt") == b"456"
        await storage.delete_many(["item1.txt", "item2.txt"])
        with pytest.raises(StorageError):
            await storage.get_bytes("item1.txt")
        with pytest.raises(StorageError):
            await storage.get_bytes("item2.txt")

    asyncio.run(run())


def test_s3_adapter_delete_many() -> None:
    class Client:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, object]]] = []

        def delete_objects(self, **kwargs: object) -> None:
            self.calls.append(("delete_objects", kwargs))

    backend = S3StorageBackend.__new__(S3StorageBackend)
    backend._bucket_name = "private-bucket"
    backend._client = Client()

    async def run() -> None:
        await backend.delete_many(["file1.wav", "file2.wav"])

    asyncio.run(run())
    assert len(backend._client.calls) == 1
    call = backend._client.calls[0]
    assert call[1]["Bucket"] == "private-bucket"
    assert call[1]["Delete"] == {
        "Objects": [{"Key": "file1.wav"}, {"Key": "file2.wav"}],
        "Quiet": True,
    }



def test_storage_factory_selects_seaweed() -> None:
    backend = build_storage_backend(
        Settings(
            _env_file=None,
            storage_backend="seaweed",
            seaweed_master_url="http://103.163.215.105:9333",
            seaweed_public_url="https://media3.h2qsolution.com",
        )
    )
    assert isinstance(backend, SeaweedStorageBackend)
    assert backend._master_url == "http://103.163.215.105:9333"
    assert backend._public_url == "https://media3.h2qsolution.com"


def test_seaweed_storage_lifecycle_with_mock_transport(tmp_path: Path) -> None:
    import httpx

    volumes_data: dict[str, bytes] = {}
    assignments = ["2800,mock1111", "2800,mock2222"]

    def handle_request(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        method = request.method

        if "/dir/assign" in url:
            fid = assignments.pop(0) if assignments else "2800,mock9999"
            return httpx.Response(200, json={"fid": fid, "url": "mock-volume:9999", "publicUrl": "https://media3.h2qsolution.com"})

        if "/dir/lookup" in url:
            return httpx.Response(200, json={"volumeId": "2800", "locations": [{"url": "mock-volume:9999"}]})

        if "mock-volume:9999" in url:
            fid = url.split("/")[-1].split("?")[0]
            if method == "PUT":
                volumes_data[fid] = request.content
                return httpx.Response(201, json={"size": len(request.content)})
            elif method == "GET":
                if fid not in volumes_data:
                    return httpx.Response(404)
                data = volumes_data[fid]
                range_header = request.headers.get("Range")
                if range_header and range_header.startswith("bytes="):
                    parts = range_header[6:].split("-")
                    start = int(parts[0])
                    end = int(parts[1]) if parts[1] else len(data) - 1
                    slice_data = data[start : end + 1]
                    return httpx.Response(206, content=slice_data)
                return httpx.Response(200, content=data)
            elif method == "DELETE":
                volumes_data.pop(fid, None)
                return httpx.Response(202, json={"size": 1})

        return httpx.Response(404)

    transport = httpx.MockTransport(handle_request)
    mock_client = httpx.AsyncClient(transport=transport)

    backend = SeaweedStorageBackend(
        master_url="http://mock-master:9333",
        database_url=None,
        local_root=tmp_path / "cache",
        public_url="https://media3.h2qsolution.com",
    )
    backend._client = mock_client

    async def run() -> None:
        key = "media/meetings/test/audio.wav"
        test_payload = b"RIFF-WAVE-PCM-TEST-PAYLOAD"

        # 1. Put bytes
        await backend.put_bytes(test_payload, key)
        assert "2800,mock1111" in volumes_data

        # 2. Get bytes
        retrieved = await backend.get_bytes(key)
        assert retrieved == test_payload

        # 3. Get range
        rng = await backend.get_range(key, 0, 8)
        assert rng == test_payload[0:9]

        # 4. Download file
        dest = tmp_path / "downloaded.wav"
        await backend.download_file(key, dest)
        assert dest.read_bytes() == test_payload

        # 5. Presigned url
        url = await backend.presigned_get_url(key, 300)
        assert url == "https://media3.h2qsolution.com/2800,mock1111"

        # 6. Delete
        await backend.delete(key)
        assert "2800,mock1111" not in volumes_data
        with pytest.raises(StorageNotFoundError):
            await backend.get_bytes(key)

        await backend.dispose()

    asyncio.run(run())


def test_seaweed_storage_with_mock_redis(tmp_path: Path) -> None:
    import httpx

    volumes_data: dict[str, bytes] = {}
    redis_db: dict[str, bytes] = {}

    class MockRedis:
        async def set(self, key: str, value: str) -> None:
            redis_db[key] = value.encode('utf-8')

        async def get(self, key: str) -> bytes | None:
            return redis_db.get(key)

        async def mget(self, keys: list[str]) -> list[bytes | None]:
            return [redis_db.get(k) for k in keys]

        async def delete(self, *keys: str) -> None:
            for k in keys:
                redis_db.pop(k, None)

        async def aclose(self) -> None:
            pass

    def handle_request(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        method = request.method

        if '/dir/assign' in url:
            return httpx.Response(200, json={'fid': '2900,abc1234', 'url': 'mock-volume:9999', 'publicUrl': 'https://media3.h2qsolution.com'})

        if '/dir/lookup' in url:
            return httpx.Response(200, json={'volumeId': '2900', 'locations': [{'url': 'mock-volume:9999'}]})

        if 'mock-volume:9999' in url:
            fid = url.split('/')[-1].split('?')[0]
            if method == 'PUT':
                volumes_data[fid] = request.content
                return httpx.Response(201, json={'size': len(request.content)})
            elif method == 'GET':
                if fid not in volumes_data:
                    return httpx.Response(404)
                return httpx.Response(200, content=volumes_data[fid])
            elif method == 'DELETE':
                volumes_data.pop(fid, None)
                return httpx.Response(202, json={'size': 1})

        return httpx.Response(404)

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handle_request))

    backend = SeaweedStorageBackend(
        master_url='http://mock-master:9333',
        database_url=None,
        redis_url=None,
        local_root=tmp_path / 'cache',
        public_url='https://media3.h2qsolution.com',
    )
    backend._client = mock_client
    backend._redis = MockRedis()

    async def run() -> None:
        key = 'media/meetings/test/recording.wav'
        payload = b'HEADER-MOCK-AUDIO-PAYLOAD'

        # Put -> writes to Seaweed volume and to Redis
        await backend.put_bytes(payload, key)
        assert 'bocbang:seaweed:' + key in redis_db
        assert redis_db['bocbang:seaweed:' + key] == b'2900,abc1234'
        assert volumes_data['2900,abc1234'] == payload

        # Get -> reads mapping from Redis, data from Seaweed volume
        data = await backend.get_bytes(key)
        assert data == payload

        # Presigned url -> resolves fid from Redis
        url = await backend.presigned_get_url(key, 300)
        assert url == 'https://media3.h2qsolution.com/2900,abc1234'

        # Delete -> cleans up Seaweed volume and Redis key
        await backend.delete(key)
        assert 'bocbang:seaweed:' + key not in redis_db
        assert '2900,abc1234' not in volumes_data

        with pytest.raises(StorageNotFoundError):
            await backend.get_bytes(key)

        await backend.dispose()

    asyncio.run(run())
