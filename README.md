# Bóc Băng AI

Web bóc băng cuộc họp: thu âm hoặc tải file, chỉnh sửa transcript, dịch VI ↔ EN,
tóm tắt và xuất tài liệu. Frontend React/TypeScript, backend FastAPI.

## Chạy local bằng Docker

Cài và mở **Docker Desktop** với Linux containers. Không cần cài riêng Python,
Node.js, PostgreSQL, Redis hay FFmpeg. Lần chạy đầu cần internet để tải dependencies.

### 1. Tạo cấu hình

Mở terminal PowerShell tại thư mục dự án (nơi có `compose.yaml`):

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Mở file `.env` ở thư mục gốc và điền:

| Biến | Cần làm |
| --- | --- |
| `JWT_SECRET` | Điền chuỗi ngẫu nhiên dài. Có thể tạo bằng lệnh bên dưới. |
| `SPEECHMATICS_API_KEY` | Điền key Speechmatics để bóc băng/nhận diện người nói. |
| `LLM_API_KEY` | Điền key Gemini để dịch và tóm tắt; có thể dùng chung key này cho cả hai. |
| `STT_FALLBACK_PROVIDER` | Nếu có key AssemblyAI, giữ `assemblyai` và điền `STT_API_KEY`; nếu chưa có, sửa thành `STT_FALLBACK_PROVIDER=`. |

Tạo giá trị rồi sao chép vào `JWT_SECRET`:

```powershell
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

Giữ `FRONTEND_ORIGIN=http://localhost:5173`. `DATABASE_URL`, `REDIS_URL` và
`VITE_*` có thể để trống với cấu hình mẫu: Compose tự cấu hình cho local.

**Chưa có key AI?** Vẫn điền `JWT_SECRET`, rồi để trống các lựa chọn sau trong
`.env`. Web vẫn chạy để dùng tài khoản/quản lý cuộc họp; bóc băng, dịch và tóm
tắt sẽ chưa dùng được:

```dotenv
STT_PROVIDER=
STT_FALLBACK_PROVIDER=
TRANSLATION_PROVIDER=
TRANSLATION_FALLBACK_PROVIDER=
LLM_PROVIDER=
LLM_FALLBACK_PROVIDER=
```

### 2. Khởi động web

```powershell
docker compose up --build -d
docker compose ps -a
```

Đợi build và khởi động xong, mở **[http://localhost:5173](http://localhost:5173)**.
Service `migrate` hiện `Exited (0)` là bình thường: database đã được cập nhật.
Tài liệu API: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs).

### 3. Đăng ký và sử dụng

Đăng ký tài khoản trên web. Khi `EMAIL_PROVIDER` để trống, OTP hiển thị trong
log API thay vì gửi email:

```powershell
docker compose logs -f api
```

Nhập OTP để xác minh rồi đăng nhập. Tạo cuộc họp, chọn thu âm hoặc tải file;
cho phép microphone nếu thu âm. Sau khi có transcript, có thể sửa, dịch,
tóm tắt và xuất file. Google login và gửi email thật cần cấu hình riêng theo
[hướng dẫn môi trường](docs/deployment/environment.md).

## Các lệnh thường dùng

| Việc cần làm | Lệnh |
| --- | --- |
| Xem lỗi khởi động/job | `docker compose logs --tail=100 api worker migrate` |
| Chạy lại sau khi sửa code hoặc cấu hình frontend | `docker compose up --build -d` |
| Áp dụng migration mới trên database đã có | `docker compose run --rm migrate` |
| Áp dụng thay đổi cấu hình backend trong `.env` | `docker compose up -d` |
| Dừng web, giữ dữ liệu | `docker compose down` |

Nếu không mở được web, kiểm tra Docker Desktop đang chạy, port 5173/8000 còn
trống và key của các provider đã chọn được điền. **`docker compose down -v`
xóa database và các file đã lưu**, chỉ dùng khi muốn xóa toàn bộ dữ liệu local.

## Tài liệu chi tiết

- [Cấu hình môi trường](docs/deployment/environment.md) · [Triển khai](docs/deployment/deployment.md)
- Chạy trực tiếp để phát triển: [Backend](backend/README.md) · [Frontend](frontend/README.md)
- [Kiến trúc](docs/architecture/architecture.md) · [API](docs/architecture/api-spec.md) · [Trạng thái dự án](project_context/CURRENT_STATUS.md)
