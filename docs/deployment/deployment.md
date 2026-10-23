# Triển khai Bóc Băng AI

_Đối chiếu Compose, Dockerfiles và runtime entrypoints: 2026-10-08._

## Local Docker Compose

Repo có stack local hoàn chỉnh, chạy từ root với Docker Desktop/Linux containers:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Điền JWT_SECRET và credentials cần dùng trong .env trước khi khởi động.
docker compose up --build -d
docker compose ps -a
docker compose logs -f api worker reconciler
```

| Service | Vai trò |
| --- | --- |
| `postgres`, `redis` | PostgreSQL 16, Redis 7.4; dữ liệu lưu volume, không publish host port. |
| `migrate` | `alembic upgrade head`, one-off; exit 0 là thành công. |
| `api` | FastAPI port `127.0.0.1:8000`; readiness database gate. |
| `worker` | Dramatiq, một process/bốn threads; xử lý media/STT, AI và export. |
| `reconciler` | Phát lại durable queued/due-retrying jobs. |
| `frontend` | Node 22 build + Nginx SPA fallback tại `127.0.0.1:5173`. |

API/worker/reconciler chờ PostgreSQL/Redis healthy và migration thành công.
Frontend chờ API ready. Backend image Python 3.12 có FFmpeg/ffprobe và Unicode
PDF fonts. API/worker dùng chung `media_data`; DB/Redis dùng volume riêng.

Compose ghi đè `APP_ENVIRONMENT`, `DATABASE_URL`, `REDIS_URL`, `QUEUE_BACKEND`,
`STORAGE_BACKEND`, `MEDIA_STORAGE_PATH`. Root `.env` cung cấp provider/auth
config và frontend public build arguments; `frontend/.env` không cần cho stack.
Browser truy cập API qua `localhost:8000`, không qua hostname service `api`.

## Cập nhật và kiểm tra

```powershell
# Migration mới trên stack đã có
docker compose run --rm migrate
# Source, dependency hoặc Vite build config thay đổi
docker compose up --build -d
# Chỉ đổi backend env
docker compose up -d
# Dừng stack, giữ volume
docker compose down
```

`docker compose down -v` xóa database, queue và toàn bộ uploaded/exported files
trong volume. Đừng dùng để cập nhật ứng dụng. Để live-edit frontend, dừng
`docker compose stop frontend` và chạy Vite trên host theo
[frontend README](../../frontend/README.md).

- UI: `http://localhost:5173`.
- Swagger/OpenAPI: `http://localhost:8000/api/v1/docs`, `/api/v1/openapi.json`.
- Liveness: `/api/v1/health`; readiness: `/api/v1/ready` (chỉ database).
- Capability: `/api/v1/capabilities`; không chứng minh provider request thành công.
- Migration lỗi: đọc `docker compose logs migrate`.
- Job không chạy: kiểm tra worker/reconciler, Redis và job state từ API.

## Triển khai public

Render là target thiết kế của dự án; chưa có `render.yaml` hoặc deploy tự động
trong repo. Phần này mô tả topology và runtime cần cấu hình, không phải một
deployment đã được xác minh.

| Process / dependency | Cấu hình |
| --- | --- |
| Static frontend | Build `npm ci`, `npm run build` từ `frontend/`; publish `dist/`, SPA fallback. |
| API | Backend image; `uvicorn app.main:app --host 0.0.0.0 --port <platform-port>`. |
| Worker | Cùng backend image; `dramatiq app.workers.worker`. |
| Reconciler | Cùng backend image; `python -m app.workers.reconciler`. |
| Migration | One-off `alembic upgrade head` trước application rollout. |
| Database / queue | Managed PostgreSQL và Redis-compatible service. |
| Storage | S3-compatible private bucket; adapter đã có, chọn `STORAGE_BACKEND=s3`. |

Các Python process chạy từ backend working directory, cùng database/Redis và
config storage/provider phù hợp. Với S3 không cần shared filesystem; API cần
ffprobe/FFmpeg cho upload/enrollment, worker cần FFmpeg/ffprobe cho processing.
Không dùng local ephemeral filesystem để giữ media/export public deployment.

Thiết lập `APP_ENVIRONMENT=production`, exact HTTPS frontend origin, HTTPS REST
và WSS browser URL, OAuth callback public, JWT secret và SMTP delivery. Frontend
chỉ nhận `VITE_*`; S3/OAuth/provider credentials chỉ ở backend. Cho phép bucket
CORS theo frontend origin khi browser dùng presigned URLs. Xem đầy đủ
[cấu hình môi trường](environment.md).

## Smoke test sau triển khai

1. Register → OTP verification → login; Google OAuth; recovery.
2. Tạo upload meeting, upload file hợp lệ, job hoàn tất và transcript/speakers.
3. Nghe retained media, seek theo segment, edit/split/merge/rollback và reload.
4. Đăng ký voice profile 10–25 giây; realtime hai người với diarization,
   kiểm tra tên, partial/final, pause/resume/stop, fallback warning và reload.
5. Dịch VI ↔ EN, summary ba template/VI-EN, export sáu formats và tải kết quả.
6. Kiểm tra ACL owner/read/comment/edit; public share transcript, expiry/revoke.
7. Xóa media vẫn giữ transcript; xóa meeting loại bỏ dữ liệu và storage objects.

Public share hiện chỉ đọc metadata/transcript, không có comment/edit bằng token
hay endpoint share summary/translation/media. Media download đã sửa Request và
stream theo phần; recording_assembly cần worker/reconciler và storage chung như
các job hiện tại, không cần migration mới. Cần smoke-test local/S3 và browser.
Export download có handler riêng. Những kiểm tra
provider/browser ở trên phải chạy thật; tài liệu cập nhật không thay thế E2E.
