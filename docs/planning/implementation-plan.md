# Implementation Plan v2

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

## P0 --- Rebuild repository foundation

-   Tạo `frontend/` React+TS maintainable từ UI hiện tại.
-   Tạo `backend/` FastAPI.
-   Docker local, PostgreSQL, Redis, Alembic.
-   Health checks.
-   FFmpeg availability.
-   CI lint/test skeleton.

## P1 --- Auth

-   Email/password.
-   OTP verify email.
-   Google OAuth.
-   Refresh/logout.
-   User profile.

## P2 --- Meeting + ACL

-   Meeting CRUD.
-   Owner authorization.
-   members read/comment/edit.
-   share links.
-   comments.

## P3 --- Media pipeline

-   upload limits/config.
-   ffprobe validate.
-   FFmpeg normalization.
-   object storage.
-   job queue.

## P4 --- Open provider framework

-   provider registry.
-   capability models.
-   normalized outputs.
-   contract tests.
-   `/capabilities`.

## P5 --- STT batch vertical slice

-   implement first real STT adapter.
-   VI/EN.
-   diarization.
-   transcript/speaker persistence.
-   frontend integration.

**Milestone 1: upload → transcript thật.**

## P6 --- Transcript editor + versioning

-   edit/delete/split/merge.
-   transcript snapshots/versions.
-   version history UI.
-   speaker editing.

## P7 --- Realtime

-   MediaRecorder.
-   WSS.
-   streaming adapter capability.
-   partial/final.
-   reconnect/dedup.

Backend WebSocket support is implemented at
`/api/v1/realtime/{meeting_id}` with authenticated ACL access, binary chunks,
pause/resume/stop, capability gating, final-only persistence and structured
retryable errors. A real streaming adapter and browser MediaRecorder wiring are
still deployment/frontend integration work.

## P8 --- Translation

-   provider registry implementation.
-   first real provider.
-   VI↔EN.
-   segment-aligned output.

## P9 --- Summary

-   first LLM adapter.
-   general/briefing/voting.
-   summary versions.

## P10 --- Export

-   PDF, DOCX, TXT, SRT, VTT, JSON.
-   async export where appropriate.

## P11 --- Deploy

-   Render services.
-   object storage.
-   secrets.
-   Google OAuth production callback.
-   email OTP provider.
-   migrations.
-   smoke test.

## Phase rule

Agent phải: 1. đọc docs; 2. inspect source; 3. plan; 4. implement; 5.
test; 6. update docs nếu contract thay đổi; 7. báo blocker; 8. không tự
skip acceptance criteria.
