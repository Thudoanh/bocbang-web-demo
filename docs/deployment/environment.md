# Cấu hình môi trường

_Đối chiếu Settings, provider factory và Compose: 2026-10-08._

Backend đọc `.env` ở root repository kể cả khi chạy từ `backend/`; biến môi
trường process ghi đè file. Vite chạy trực tiếp đọc `frontend/.env`. Compose
đọc root `.env`, chỉ chuyển build argument công khai cho frontend.

## Runtime và auth

| Biến | Giá trị / cách dùng |
| --- | --- |
| `APP_ENVIRONMENT` | Mặc định `development`; `production/prod` bắt buộc Redis khi tạo ứng dụng. Compose chọn development. |
| `DATABASE_URL` | Cần cho dữ liệu nghiệp vụ; `postgres://` và `postgresql://` đổi sang `postgresql+asyncpg://`. Compose tự cấu hình PostgreSQL nội bộ. |
| `REDIS_URL`, `QUEUE_BACKEND` | Queue backend chỉ nhận `redis`; Redis cần cho enqueue và worker/reconciler. Compose tự cấu hình URL nội bộ. |
| `JWT_SECRET` | Secret ký access/refresh JWT và playback ticket. Đặt chuỗi ngẫu nhiên dài; Compose từ chối giá trị trống. |
| `FRONTEND_ORIGIN` | Mặc định `http://localhost:5173`, dùng CORS và OAuth handoff. Alias ưu tiên `FRONTEND_ORIGINS` nhận danh sách phân cách dấu phẩy. |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS` | `900`, `2592000`; chưa có server-side revoke token. |
| `LOG_LEVEL` | `INFO`. |
| `PERFORMANCE_QUERY_TIMING_ENABLED`, `PERFORMANCE_SLOW_QUERY_MS` | `false`, `100.0`; đo query khi cần audit. |
| `EMAIL_PROVIDER` | `smtp` cần `EMAIL_FROM`, `EMAIL_SMTP_HOST`; development để trống dùng console in OTP vào API stdout, không gửi email. `console/dev/local` cũng chọn console. `EMAIL_API_KEY` chưa có email API adapter. |
| `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USE_TLS` | `587`, `true`; thêm `EMAIL_SMTP_USERNAME`/`EMAIL_SMTP_PASSWORD` nếu SMTP yêu cầu. |
| `EMAIL_OTP_TTL_SECONDS`, `EMAIL_OTP_MAX_ATTEMPTS` | `600`, `5`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Cần cả ba cho OAuth; callback local `http://localhost:8000/api/v1/auth/google/callback` phải khớp URI đăng ký. |

PostgreSQL và Redis trong Compose không publish port. URL `postgres:5432` và
`redis:6379` chỉ dùng trong mạng container; Python chạy host cần database/Redis
khác truy cập được từ host. SMTP chạy host với Docker Desktop dùng
`EMAIL_SMTP_HOST=host.docker.internal`.

## Provider startup

Env mẫu đã chọn Speechmatics, AssemblyAI fallback và Gemini; các factory kiểm
tra key khi tạo ứng dụng, nên chỉ copy env mẫu rồi điền JWT chưa đủ chạy stack.
Điền key cho mọi primary/fallback đã chọn. Để chạy không có AI, bỏ lựa chọn
`STT_PROVIDER`, `STT_FALLBACK_PROVIDER`, `TRANSLATION_PROVIDER`,
`TRANSLATION_FALLBACK_PROVIDER`, `LLM_PROVIDER`, `LLM_FALLBACK_PROVIDER`.
Capability tương ứng sẽ false/empty, thao tác phụ thuộc bị từ chối.
Fallback không xử lý lỗi thiếu key của primary trong quá trình startup.

## STT và voice profile

| Biến | Cách dùng |
| --- | --- |
| `STT_PROVIDER` | `.env.example` chọn `speechmatics`; Settings không tự chọn nếu chưa khai báo. |
| `SPEECHMATICS_API_KEY` | Speechmatics batch/realtime và enrollment nhận diện theo tên. |
| `SPEECHMATICS_RT_URL` | `wss://eu2.rt.speechmatics.com/v2`. |
| `SPEECHMATICS_BATCH_URL` | Override endpoint batch tùy chọn; để trống dùng SDK default. |
| `SPEECHMATICS_SPEAKER_SENSITIVITY` | `0.75`, khoảng `0–1`. |
| `SPEECHMATICS_PREFER_CURRENT_SPEAKER` | `false`. |
| `SPEECHMATICS_END_OF_UTTERANCE_SILENCE_SECONDS` | `1.0`, khoảng `0.1–5.0`. |
| `STT_FALLBACK_PROVIDER` | `.env.example` chọn `assemblyai`; chỉ fallback khi lỗi STT retryable lúc mở stream hoặc batch. |
| `STT_API_KEY`, `STT_MODEL` | Key và batch model AssemblyAI; model `universal-3-pro`. |
| `ASSEMBLYAI_STREAMING_MODEL`, `ASSEMBLYAI_STREAMING_MODE` | `universal-3-6-pro`, `balanced`; mode nhận `min_latency/balanced/max_accuracy`. |
| `ASSEMBLYAI_API_BASE_URL`, `ASSEMBLYAI_STREAMING_BASE_URL` | Endpoint mặc định trong Settings; có thể override. |
| `STT_POLL_INTERVAL_SECONDS`, `STT_POLL_TIMEOUT_SECONDS` | `2`, `1800`. |

Fallback không chuyển provider giữa stream và không dùng Speechmatics
voiceprints để nhận diện tên. Enrollment cần FFmpeg, mẫu 10–25 giây, một người
nói; mỗi profile tối đa ba identifiers, phiên tối đa 50 identifiers phân bổ
round-robin. Sample bytes được xử lý tạm, identifiers chỉ lưu phía backend.

## Dịch và tóm tắt

- `TRANSLATION_PROVIDER=gemini` hoặc `groq`; Gemini dùng
  `TRANSLATION_API_KEY` hoặc `LLM_API_KEY`. `TRANSLATION_FALLBACK_PROVIDER=groq`
  với `GROQ_API_KEY` bật fallback sau lỗi primary.
- `LLM_PROVIDER=gemini` hoặc `groq`; Gemini dùng `LLM_API_KEY` hoặc `TRANSLATION_API_KEY`.
  `LLM_FALLBACK_PROVIDER=groq` với `GROQ_API_KEY` bật summary fallback.
- `GEMINI_MODEL` mặc định trong Settings là `gemini-2.5-flash`; `LLM_MODEL`
  ghi đè model cho summary. Giá trị `.env` ghi đè các mặc định này.
- `GROQ_MODEL` mặc định `openai/gpt-oss-20b`; `GEMINI_API_BASE_URL` và
  `GROQ_API_BASE_URL` có thể override endpoint.
- Summary request bắt buộc `output_language=vi/en`; dịch hỗ trợ VI ↔ EN theo
  `language_pairs` từ capability endpoint.

## Storage, media và queue

| Biến | Mặc định / ghi chú |
| --- | --- |
| `STORAGE_BACKEND` | `local` hoặc `s3`; Compose chọn local với volume chung API/worker. |
| `MEDIA_STORAGE_PATH` | Settings mặc định `<repo>/.local-media`. Giá trị tương đối trong `.env` phụ thuộc working directory; API/worker phải dùng cùng đường dẫn. Compose dùng `/data/media`. |
| `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_REGION` | S3 adapter đã có; bucket private, region `auto`. Endpoint tùy chọn khi dùng AWS. |
| `STORAGE_PRESIGNED_URL_TTL_SECONDS`, `MEDIA_PLAYBACK_TICKET_TTL_SECONDS` | `300`, `300`; URL S3 và ticket playback local. |
| `MAX_UPLOAD_BYTES`, `MAX_MEDIA_DURATION_SECONDS` | `524288000` (500 MiB), `7200` (hai giờ). |
| `WORKER_MAX_RETRIES` | `3`. |
| `WORKER_RETRY_MIN_BACKOFF_MS`, `WORKER_RETRY_MAX_BACKOFF_MS` | `10000`, `60000`. |
| `WORKER_RECONCILE_INTERVAL_SECONDS`, `WORKER_RECONCILE_BATCH_SIZE` | `15`, `100`. |
| `WORKER_DELIVERY_TIMEOUT_SECONDS` | `300`; trước khi phát lại queued job chưa được nhận. |

API/worker/reconciler dùng cùng database và Redis. Local storage cần thư
mục/volume chung; S3 dùng chung bucket nên không cần filesystem chung.

## Frontend

| Biến | Chạy Vite trên host | Compose build argument |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | Root `.env`, trống dùng URL này. |
| `VITE_WS_BASE_URL` | `ws://localhost:8000/api/v1` | Root `.env`, trống dùng URL này. |
| `VITE_MAX_UPLOAD_BYTES` | `524288000` | Lấy từ root `MAX_UPLOAD_BYTES`. |
| `VITE_MAX_MEDIA_DURATION_SECONDS` | `7200` | Lấy từ root `MAX_MEDIA_DURATION_SECONDS`. |

Giá trị Vite công khai và nhúng vào bundle lúc build, không chứa secret.
Đổi chúng trong Compose cần `docker compose up --build -d`; chạy host cần
restart Vite sau khi đổi `frontend/.env`. Backend vẫn kiểm tra giới hạn thật.
