# System Architecture v2

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

## 1. Logical architecture

``` text
React/TypeScript Browser
  | HTTPS REST
  | WSS
  v
+------------------------------------------------------+
|                    FastAPI                           |
| Auth | Users | Meetings | ACL | Media | Transcript  |
| Speakers | Comments | Translation | Summary         |
| Export | Share | Versioning | Jobs                  |
+-----------+-------------------+----------------------+
            |                   |
            v                   v
       PostgreSQL          S3-compatible Storage
            |
            v
          Redis
            |
            v
     Background Worker
       |       |       |
       v       v       v
      STT  Translation  LLM
```

## 2. Architectural style

**Modular monolith + worker.**

Rationale: - đủ đơn giản cho demo; - transaction/data model dễ quản
lý; - vẫn tách provider và module để mở rộng; - worker tách long-running
tasks khỏi HTTP.

## 3. Media normalization

``` text
uploaded file
  -> ffprobe validation
  -> FFmpeg extract/normalize audio
  -> canonical working audio
  -> selected STT adapter
```

Canonical format có thể là PCM/WAV hoặc provider-specific optimized
format; adapter quyết định conversion cuối.

## 4. Permission model

Không cần global Admin cho demo. Cần resource-level ACL vì có
share/collaboration.

``` text
OWNER > EDIT > COMMENT > READ
```

Authorization service phải được gọi trước mọi meeting-scoped operation.

## 5. Versioning

Transcript: - mỗi saved logical revision tạo `transcript_versions`; -
segment state gắn version hoặc snapshot strategy; - current version
pointer ở transcript.

Summary: - regenerate tạo summary version mới; - version cũ immutable.

## 6. Delete

Delete meeting là destructive cascade: 1. authorize owner; 2. mark
deletion transactionally; 3. delete/revoke share links; 4. enqueue
storage cleanup; 5. delete DB dependents theo policy; 6. record audit
event tối thiểu nếu cần vận hành.

## 7. Deployment portability

Render là target demo, không xuất hiện trong domain/service code. Mọi
dependency qua URL/env để có thể chuyển sang Railway/AWS/GCP/Azure sau
này.
