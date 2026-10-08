# Deploy bản `Tunggg`: Vercel + Render

Đây là cấu hình production thực dụng cho ứng dụng hiện tại:

- Frontend React/Vite: Vercel.
- FastAPI, WebSocket, FFmpeg, Dramatiq worker và reconciler: Render.
- PostgreSQL và Redis-compatible Key Value: Render managed services.
- Audio, video và file export: bucket private S3-compatible, khuyến nghị Cloudflare R2.

Không đưa `.env` lên Git. Không dùng filesystem của web service để lưu media.

## 1. Chuẩn bị object storage

Tạo một bucket private và một bộ access key riêng cho ứng dụng. Cần các giá trị:

```text
S3_ENDPOINT_URL
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_BUCKET_NAME
S3_REGION=auto
```

Nếu dùng Cloudflare R2, cấu hình CORS của bucket chỉ cho phép origin frontend
production và các phương thức cần thiết. Bucket vẫn phải để private.

## 2. Deploy backend trên Render

1. Kết nối repository GitHub `Thudoanh/bocbang-web-demo` với Render.
2. Tạo Blueprint từ file `render.yaml` và xác nhận branch là `Tunggg`.
3. Nhập các biến được Render đánh dấu `sync: false`:

   - `FRONTEND_ORIGINS`: URL HTTPS cố định dự kiến của frontend Vercel.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
   - `GOOGLE_REDIRECT_URI`: `https://<api-domain>/api/v1/auth/google/callback`.
   - Toàn bộ biến `S3_*` của bucket private.
   - `STT_API_KEY` của AssemblyAI.
   - `TRANSLATION_API_KEY` và `LLM_API_KEY` của Gemini.

4. Blueprint tạo API, worker, reconciler, PostgreSQL và Key Value trong region
   Singapore. Migration Alembic chạy trước mỗi lần deploy API.
5. Chờ `https://<api-domain>/api/v1/ready` trả về trạng thái `ready`.

Không đổi `STORAGE_BACKEND=s3` sang `local` ở production. API và worker là hai
máy khác nhau nên ổ đĩa local không thể dùng chung.

## 3. Deploy frontend trên Vercel

1. Import cùng repository vào Vercel.
2. Đặt **Production Branch** là `Tunggg` để không dùng `main`.
3. Đặt **Root Directory** là `frontend`.
4. Framework preset: Vite. Build command: `npm run build`. Output: `dist`.
5. Thêm bốn biến public từ `frontend/.env.production.example`, thay
   `<api-domain>` bằng domain API Render thật. Production phải dùng `https://`
   và WebSocket phải dùng `wss://`.
6. Deploy preview trước. Kiểm tra đăng nhập, điều hướng trực tiếp vào một URL
   con và kết nối realtime rồi mới promote production.

`frontend/vercel.json` đã có SPA rewrite nên refresh các đường dẫn như
`/meetings/<id>` không bị 404.

## 4. Hoàn tất Google OAuth và CORS

Sau khi có URL thật của cả hai dịch vụ:

1. Cập nhật `FRONTEND_ORIGINS` trên Render bằng origin Vercel chính xác, không
   có dấu `/` cuối. Có thể nhập nhiều origin, phân tách bằng dấu phẩy.
2. Cập nhật `GOOGLE_REDIRECT_URI` bằng callback API chính xác.
3. Thêm đúng callback đó vào **Authorized redirect URIs** của Google Cloud.
4. Restart API sau khi đổi biến môi trường.

Không đặt client secret, khóa AI, database URL, Redis URL hay khóa S3 vào biến
`VITE_*`; các biến này được đóng gói công khai trong JavaScript trình duyệt.

## 5. Kiểm tra sau deploy

Thực hiện theo thứ tự:

1. API `/api/v1/ready` trả HTTP 200.
2. Đăng ký, nhận OTP và đăng nhập; nếu chưa cấu hình email thì cấu hình SMTP
   hoặc email provider trước khi kiểm tra bước này.
3. Đăng nhập Google và xác nhận quay lại frontend đúng tài khoản.
4. Tạo cuộc họp, upload file nhỏ, chờ worker xử lý thành công.
5. Kiểm tra transcript, phân người nói, dịch, tóm tắt và export.
6. Ghi âm realtime ít nhất vài phút và xác nhận kết nối tự phục hồi khi mạng
   gián đoạn ngắn.
7. Xóa media/cuộc họp và kiểm tra object trong bucket cũng được xóa.

## 6. Khôi phục bản backup local

File backup local chứa source tại thời điểm sao lưu, Git bundle của nhánh
`Tunggg`, PostgreSQL dump, Redis snapshot và thư mục media. Backup có cả `.env`
nên phải được giữ riêng tư, không upload vào Git, Vercel hoặc Render.

Khôi phục PostgreSQL custom dump bằng `pg_restore`; source history có thể clone
từ file `.bundle`. Chỉ khôi phục Redis khi cần giữ các job đang chờ; PostgreSQL
mới là nguồn trạng thái job chính.

