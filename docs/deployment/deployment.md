# Deployment Design --- Demo

## Decisions đã chốt

-   **Phân quyền:** không có global Admin trong web demo. Mỗi meeting có
    `owner` và cộng tác viên theo ACL `read | comment | edit`. Đây là
    phân quyền theo tài nguyên, cần thiết vì hệ thống có chia sẻ/cộng
    tác.
-   **Đăng ký:** email + password và bắt buộc xác minh email bằng OTP
    trước khi kích hoạt đầy đủ.
-   **Google Login:** Google OAuth thật.
-   **Upload demo:** tối đa **500 MB/file** và **2 giờ/file**, cấu hình
    bằng environment. Hỗ trợ đầu vào phổ biến:
    `mp3, wav, m4a, aac, flac, ogg, opus, webm, mp4, mov, mkv, avi, mpeg/mpg`.
    Backend dùng **FFmpeg** để probe/normalize audio trước STT, vì
    provider không nhất thiết nhận mọi container/codec.
-   **STT:** kiến trúc provider mở. Demo phải có ít nhất một adapter
    thật; provider được chọn qua config. Capability model quyết định
    `batch`, `streaming`, `diarization`, `languages`, `timestamps`,
    `confidence`.
-   **Ngôn ngữ STT:** demo bảo đảm Việt + Anh; kiến trúc hỗ trợ mở rộng
    multilingual theo capability provider.
-   **Diarization:** bắt buộc trong demo nếu provider được chọn hỗ trợ;
    UI hiển thị Speaker 1, Speaker 2...
-   **Translation:** provider mở; demo bảo đảm VI ↔ EN; mở rộng
    multilingual theo provider.
-   **LLM:** provider mở; không hard-code vendor/model vào business
    service.
-   **Summary:** `general`, `briefing`, `voting`.
-   **Export:** PDF, DOCX, TXT, SRT, VTT, JSON.
-   **Share:** `read`, `comment`, `edit`.
-   **Retention:** không tự xóa audio theo thời gian trong demo; user có
    thể xóa audio hoặc meeting.
-   **Delete meeting:** xóa toàn bộ dữ liệu phụ thuộc và object storage
    liên quan.
-   **Versioning:** giữ lịch sử transcript và summary. Không overwrite
    version cũ.
-   **Xin ý kiến:** loại khỏi scope.
-   **Deploy demo:** ưu tiên **Render** cho frontend static, FastAPI web
    service, background worker, PostgreSQL và Redis-compatible Key
    Value; object storage dùng S3-compatible managed storage bên ngoài.
    Kiến trúc không phụ thuộc Render.
-   **Frontend:** không tiếp tục maintain bundle `script.js`; agent dựng
    lại source React/TypeScript maintainable từ UI hiện tại.

## 1. Recommended demo target

**Render** is the preferred first deployment target because it can
host: - static frontend; - FastAPI web service; - background worker; -
managed PostgreSQL; - Redis-compatible Key Value; - environment/secrets
and Git-based deploy.

Object media should remain in S3-compatible object storage rather than
service filesystem.

The current filesystem `MediaStorage` adapter is development/test-only. Before
deployment, configure and register an S3-compatible adapter behind the same
storage boundary; do not rely on `MEDIA_STORAGE_PATH` in a Render web service.

## 2. Services

``` text
bocbang-frontend   Render Static Site
bocbang-api        Render Web Service
bocbang-worker     Render Background Worker
bocbang-postgres   Render PostgreSQL
bocbang-redis      Render Key Value
bocbang-media      S3-compatible object storage
```

## 3. Why not local filesystem

Deployment filesystem may be ephemeral. Audio, normalized media and
exports must use object storage.

## 4. Repo target

``` text
/
  frontend/
  backend/
  docs/
  render.yaml
  README.md
```

## 5. Environment

Frontend:

``` text
VITE_API_BASE_URL=https://<api-domain>/api/v1
VITE_WS_BASE_URL=wss://<api-domain>/api/v1
```

Backend:

``` text
DATABASE_URL
REDIS_URL
QUEUE_BACKEND=redis
WORKER_MAX_RETRIES=3
WORKER_RETRY_MIN_BACKOFF_MS=10000
WORKER_RETRY_MAX_BACKOFF_MS=60000
WORKER_RECONCILE_INTERVAL_SECONDS=15
WORKER_RECONCILE_BATCH_SIZE=100
WORKER_DELIVERY_TIMEOUT_SECONDS=300
FRONTEND_ORIGIN
JWT_SECRET

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI

EMAIL_PROVIDER
EMAIL_API_KEY
EMAIL_FROM

STORAGE_BACKEND=s3
S3_ENDPOINT_URL
S3_BUCKET_NAME
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_REGION=auto

STT_PROVIDER
STT_API_KEY

TRANSLATION_PROVIDER
TRANSLATION_API_KEY

LLM_PROVIDER
LLM_API_KEY
LLM_MODEL

MAX_UPLOAD_BYTES=524288000
MAX_MEDIA_DURATION_SECONDS=7200
```

The object bucket must remain private. Store S3 credentials only as backend
deployment secrets; do not expose them through `VITE_*`. The API issues
short-lived presigned GET URLs after meeting ACL checks. For local development,
set `STORAGE_BACKEND=local` and `MEDIA_STORAGE_PATH=.local-media`.
If the frontend fetches a signed object directly, allow only the frontend
origin in the bucket's CORS policy; this does not require public bucket access.

Run the API service with `uvicorn app.main:app --host 0.0.0.0 --port 8000`,
the separate worker service with `dramatiq app.workers.worker`, and a queue
reconciler with `python -m app.workers.reconciler`. They need PostgreSQL and
the same managed Redis URL; workers need private object storage and provider
secrets. Install FFmpeg and FFprobe in the worker image. The reconciler scans
durable queued/due-retrying jobs on a bounded interval, repairing an API crash
or Redis outage between DB commit and broker publish. Redis carries delivery
only; PostgreSQL remains the job-state source of truth. No shared API/worker
filesystem is required.

## 6. Deploy gate

Không deploy public nếu chưa: - HTTPS/WSS; - CORS exact origin; -
secrets server-side; - DB migration; - object storage; - worker; - OTP
email delivery; - Google OAuth redirect URI; - health checks; - smoke
test.

## 7. Smoke test

``` text
register -> OTP verify -> login
Google OAuth login
create meeting
upload supported file
job processing
STT + diarization
view transcript
edit -> new version
share read/comment/edit
translation VI<->EN
summary 3 templates
export 6 formats
delete media
delete meeting cascade
```

## 8. Portability

`render.yaml` là deployment adapter, không phải domain architecture.
Backend vẫn chạy local Docker hoặc platform khác chỉ bằng env/dependency
URLs.

## 9. Local Docker Compose

The root `compose.yaml` provides the React frontend, PostgreSQL, Redis, a one-off
Alembic migration, FastAPI, a Dramatiq worker and the queue reconciler. All Python services use
`docker/backend.Dockerfile`, which includes FFmpeg/ffprobe and DejaVu fonts for
Unicode PDF exports and runs as an unprivileged user. Database health and
successful migration gate application startup; Redis health gates the queue
consumers and API.

Create the root `.env` from `.env.example`, set `JWT_SECRET` and needed provider
credentials, then run `docker compose up --build -d`. No host Node.js/Python
installation is required. `docker/frontend.Dockerfile` installs locked npm
dependencies and builds with Node.js; its final Nginx stage serves static files
with SPA fallback for deep links. Only explicit public Vite build arguments are
passed to the frontend, and `frontend/.dockerignore` excludes local env files.
The browser connects directly to `localhost:8000` for REST/WebSocket and Google
OAuth. Changing frontend build arguments requires a rebuild. See the root README
for commands and troubleshooting.

This development stack overrides database/Redis URLs and selects local storage.
The API and worker share `media_data`; PostgreSQL and Redis have their own
persistent volumes. The frontend is published on `127.0.0.1:5173` after the API
becomes healthy; the API is published on `127.0.0.1:8000`. Its database
credentials are local defaults. Production continues to use managed databases,
private S3-compatible storage and deployment secrets as described above.
