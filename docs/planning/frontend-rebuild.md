# Frontend Rebuild Plan

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

## 1. Hiện trạng

Frontend hiện có `index.html`, `style.css`, `script.js`; `script.js` là
bundle React/TSX đã build. Agent phải dùng giao diện hiện tại làm
**visual/interaction reference**, không coi bundle là source
maintainable.

## 2. Target

Dựng React + TypeScript project mới:

``` text
frontend/
  src/
    app/
    api/
    auth/
    realtime/
    pages/
    components/
    hooks/
    state/
    types/
    utils/
  public/
  .env.example
```

Khuyến nghị Vite + React + TypeScript.

## 3. Rebuild rules

-   Giữ layout, navigation, terminology và luồng màn hình tương ứng
    prototype/BA.
-   Không copy minified/bundled logic từ `script.js` làm source chính.
-   Tách component theo chức năng.
-   Tạo API client tập trung.
-   Tạo WebSocket client riêng cho realtime.
-   Không hard-code meeting/transcript/speaker.
-   API base URL lấy từ `VITE_API_BASE_URL`.
-   Error/loading/empty/reconnecting states phải tồn tại thật.

## 4. Permission-aware UI

Meeting có: - `owner` - collaborator `read` - collaborator `comment` -
collaborator `edit`

UI: - `read`: xem/playback/export theo policy, không sửa. - `comment`:
quyền read + comment. - `edit`: quyền read + sửa
transcript/speaker/summary-related editable data. - owner: full control,
share management, delete.

## 5. Upload UX

Accepted extensions:
`mp3 wav m4a aac flac ogg opus webm mp4 mov mkv avi mpeg mpg`

Default demo limits: - 500 MB/file - 2 hours/file

Frontend chỉ pre-check để UX tốt hơn. Backend vẫn là authority.

## 6. DoD

-   Auth/OTP/Google OAuth thật.
-   Meeting/history từ DB.
-   Upload/STT thật.
-   Realtime thật khi selected provider có streaming capability.
-   Edit persist.
-   Share permission ảnh hưởng UI.
-   Version history xem được.
-   Production build không chứa secret.
