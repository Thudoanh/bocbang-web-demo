# Bóc Băng AI --- Agent Source of Truth v2

Tài liệu này là entry point cho code agent. Frontend React/TypeScript, backend,
worker/reconciler, Docker Compose và S3 adapter đã có implementation.
Đọc trạng thái hiện tại trước khi dùng các BA/audit lịch sử làm backlog.
Code là nguồn xác minh hành vi đã triển khai; BA/UI specs mô tả yêu cầu mục tiêu.

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
-   **Học giọng:** không bắt buộc thu trước; thư ký xác nhận tên và lấy mẫu
    trực tiếp từ transcript/audio cuộc họp qua durable job. Mẫu được tái sử dụng
    theo owner/member scope, không dùng thư viện của tài khoản không liên quan.
-   **Translation:** provider mở; demo bảo đảm VI ↔ EN; mở rộng
    multilingual theo provider.
-   **LLM:** provider mở; không hard-code vendor/model vào business
    service.
-   **Summary:** chọn `general`/`briefing`/`voting` hoặc nhập prompt tùy chỉnh;
    hỗ trợ VI/EN và chỉnh sửa thủ công bằng version mới.
-   **Phiên trong meeting:** Tạm dừng mở lựa chọn tạo phiên hoặc giữ phiên cũ;
    chỉ chọn Tạo phiên mới mới chốt phiên cũ/tạo phiên có tên đang chờ;
    chỉ Tiếp tục mới ghi lại. Navigation/disconnect không tách phiên. UI mặc
    định tóm tắt từng phiên, whole-meeting scope giữ tương thích output cũ.
    Xem `docs/architecture/meeting-sessions.md` và migration `0017`.
-   **Quản lý phiên:** thêm mốc, sửa boundary, xóa/gộp chỉ đổi grouping, tuyệt
    đối không sửa/xóa transcript hoặc audio. Tóm tắt được chọn nhiều phiên;
    snapshot toàn boundary trước rồi lọc input. Layout revision chống stale,
    summary versions cũ giữ nguyên, không migration bổ sung.
-   **Export:** PDF, DOCX, TXT, SRT, VTT, JSON.
-   **Share:** `read`, `comment`, `edit`.
-   **Retention:** không tự xóa audio theo thời gian trong demo; user có
    thể xóa audio hoặc meeting.
-   **Delete meeting:** xóa toàn bộ dữ liệu phụ thuộc và object storage
    liên quan.
-   **Versioning:** giữ lịch sử transcript và summary. Không overwrite
    version cũ.
-   **Làm mịn transcript:** explicit end flush STT rồi tạo proposal qua LLM;
    bản gốc/AI/nháp tách riêng, chỉ người dùng chốt mới tạo current revision.
    Xem `docs/architecture/transcript-polish.md`; không tự chốt kết quả AI.
-   **Nghe lại:** explicit end còn tạo durable `recording_assembly` độc lập AI,
    ghép raw chunks thành MediaFile WAV theo timeline, private playback/download.
    Meeting cũ chỉ khôi phục explicit khi còn audio; không hồi sinh băng đã xóa.
    Xem `docs/architecture/recording-playback.md`; không có migration mới.
-   **Xin ý kiến:** loại khỏi scope.
-   **Deploy demo:** ưu tiên **Render** cho frontend static, FastAPI web
    service, background worker, PostgreSQL và Redis-compatible Key
    Value; object storage dùng S3-compatible managed storage bên ngoài.
    Kiến trúc không phụ thuộc Render.
-   **Frontend:** source React/TypeScript + Vite đã có trong `frontend/`;
    không tiếp tục maintain bundle `prototype/script.js`.

## Thứ tự đọc bắt buộc

1.  [`../project_context/CURRENT_STATUS.md`](../project_context/CURRENT_STATUS.md)
2.  [`../project_context/DECISIONS.md`](../project_context/DECISIONS.md)
3.  [`../docs/planning/frontend-rebuild.md`](../docs/planning/frontend-rebuild.md) và
    [`../docs/deployment/environment.md`](../docs/deployment/environment.md)
4.  [`../docs/architecture/architecture.md`](../docs/architecture/architecture.md)
5.  [`../docs/architecture/provider-architecture.md`](../docs/architecture/provider-architecture.md)
6.  [`../docs/architecture/erd.md`](../docs/architecture/erd.md)
7.  [`../docs/architecture/api-spec.md`](../docs/architecture/api-spec.md)
8.  [`../docs/deployment/deployment.md`](../docs/deployment/deployment.md)
9.  [`../docs/planning/implementation-plan.md`](../docs/planning/implementation-plan.md)

## Rules

-   BA là nguồn nghiệp vụ; bộ docs này là nguồn thiết kế kỹ thuật.
-   Không thay đổi API/ERD/provider contract âm thầm. Nếu implementation
    buộc thay đổi, cập nhật docs cùng commit.
-   Không fake AI/STT result.
-   Không đưa API key vào frontend.
-   Không dùng microservices cho demo.
-   Mọi feature async phải có job state thật.
-   Mọi meeting access phải qua owner/collaborator permission.
-   Ưu tiên vertical slice đầu tiên:
    `auth → meeting → upload → STT → transcript → edit`.
-   Sau mỗi task có thay đổi repo, bắt buộc cập nhật
    [`../project_context/CURRENT_STATUS.md`](../project_context/CURRENT_STATUS.md)
    và thêm entry vào [`../project_context/TASK_LOG.md`](../project_context/TASK_LOG.md)
    theo quy ước trong [`../project_context/README.md`](../project_context/README.md).
