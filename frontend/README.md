# Bóc Băng AI frontend

Frontend đang dùng React + TypeScript + Vite, gọi REST/WebSocket FastAPI thật.
Source nằm trong `src/`; `../prototype/` chỉ là tham chiếu giao diện cũ.

## Chạy trên host

Cần Node.js/npm (Docker build hiện dùng Node 22), API ở port 8000 và backend
đã cấu hình database/auth/provider. Từ thư mục `frontend/`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run dev
```

Mở `http://localhost:5173`. Vite đọc `frontend/.env`, không đọc root `.env`.
`VITE_API_BASE_URL`/`VITE_WS_BASE_URL` gồm prefix `/api/v1`; giới hạn upload
dùng `VITE_MAX_UPLOAD_BYTES`/`VITE_MAX_MEDIA_DURATION_SECONDS`. Xem
[cấu hình môi trường](../docs/deployment/environment.md). Provider key, JWT
secret, database URL và OAuth client secret chỉ nằm phía backend.

Để chạy toàn bộ bằng Docker, làm theo [README root](../README.md); không cần
`frontend/.env`. Compose phục vụ bundle đã build bằng Nginx, source thay đổi
cần rebuild. Dừng service frontend Compose trước khi chạy Vite cùng port 5173.

## Routes và chức năng

| Route | Chức năng |
| --- | --- |
| `/`, `/meetings` | Danh sách meeting của owner/cộng tác viên. |
| `/login`, `/register`, `/forgot-password` | Auth, OTP, recovery và Google handoff. |
| `/meetings/create?mode=upload` | Tạo cuộc họp upload; bỏ `mode=upload` để tạo realtime. |
| `/meetings/:id` | Thu PCM16 mono 16 kHz qua AudioWorklet; start/pause/resume/stop, dịch realtime tạm, edit/history/rollback, nghe media upload và seek theo đoạn. |
| `/meetings/:id/upload` | Upload và theo dõi job thật. |
| `/meetings/:id/speakers` | Sửa metadata người nói, nghe sample interval khi có media. |
| `/meetings/:id/translation` | Dịch segment VI ↔ EN được lưu. |
| `/meetings/:id/summary` | Ba mẫu summary, chọn ngôn ngữ đầu ra VI/EN. |
| `/meetings/:id/export-share` | Export sáu format, thành viên ACL và share link. |
| `/history`, `/settings` | Filter lịch sử; sửa full name, đăng ký/thêm/xóa mẫu giọng cá nhân. |
| `/share/:token` | Public read-only metadata + transcript qua capability token. |

Auth route dùng chung `AuthPage`; routing dùng `window.location` và match
pathname trong `App.tsx`, chưa dùng thư viện router. Host static cần SPA
fallback để mở deep link; `nginx.conf` đã cấu hình cho Docker.

## Source và kiểm tra

- `src/api`: endpoint typed, HTTP client và auth-aware requests.
- `src/auth`: access/refresh session, OTP và Google handoff.
- `src/realtime`: socket reconnect, microphone capture/resampling, PCM worklet.
- `src/state`: polling job; `src/hooks`: async state.
- `src/pages`: màn hình theo route; `src/components`: shell, UI, enrollment modal.
- `src/types`, `src/utils`: domain type, time và permission helpers.
- `src/app`: app config, routes và stylesheet.

```powershell
npm run check
npm run build
npm run preview
```

`build` chạy TypeScript check rồi Vite build; output là `dist/`. Chưa có npm
test/E2E script. Build thành công không chứng minh microphone, provider hay
playback đã qua browser E2E. Public share chưa cho comment/edit qua token và
chưa hiển thị summary/translation/media. Audio player cần media đã upload;
realtime capture hiện gửi STT, không lưu bản audio để nghe lại.
