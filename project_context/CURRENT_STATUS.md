# Current Status

_Cập nhật lần cuối: 2026-11-02 — Sửa triệt để lỗi "Missing chunk index 0" khi tải tệp; Chuẩn hóa người nói luôn bắt đầu từ "Người nói 1"; Sửa đường dẫn API dịch tức thì 2 chiều; Tối giản giao diện chờ "Đang xử lý…"; Hoàn thành bóc băng trước & dịch ngầm sau._

## Done

- **Khắc phục triệt để lỗi `Missing chunk index 0` khi tải tệp âm thanh:**
  - Nguyên nhân: Trước đây frontend chia nhỏ mọi tệp âm thanh > 2.5MB thành các chunk 2.5MB gửi qua endpoint `/chunk`. Khi triển khai trên cụm Kubernetes hoặc do độ trễ ghi đĩa bất đồng bộ, phần phân đoạn 0 (`part_00000`) bị lệch đường dẫn lưu trữ hoặc chưa kịp flush xuống ổ đĩa, khiến backend ném lỗi `ApiError: Missing chunk index 0`.
  - Khắc phục:
    1. **Frontend (`frontend/src/api/client.ts`):** Sử dụng tải lên trực tiếp (Single Direct Streaming Upload) cho tất cả các tệp có dung lượng $\le 100\text{MB}$. Ingress Kubernetes đã được cấu hình hỗ trợ tới $600\text{MB}$ (`proxy-body-size: 600m`), giúp tệp tải lên trong 1 request duy nhất, theo dõi thanh tiến trình mượt mà và triệt tiêu hoàn toàn rủi ro thiếu chunk.
    2. **Backend (`backend/app/services/media.py`):** Chuẩn hóa lưu trữ chunk đa vị trí an toàn (`candidate_dirs`), tự động tìm kiếm mảnh phân đoạn trên cả thư mục media và thư mục tạm `/tmp`. Đồng thời bổ sung `destination.flush()` và `os.fsync()` đảm bảo dữ liệu ghi đĩa vật lý xong trước khi phản hồi chunk tiếp theo.
- **Khắc phục lỗi dịch thuật tiếng Anh ("Chưa có bản dịch [Dịch ngay]"):**
  - Nguyên nhân: Tại `frontend/src/pages/MeetingPage.tsx`, các lời gọi API `translations/instant` sử dụng đường dẫn tương đối `/api/v1/translations/instant` thay vì `${config.apiBaseUrl}/translations/instant`. Do frontend được phục vụ qua Nginx container tại domain giao diện, request trả về trang HTML `index.html` khiến dịch thuật client-side bị lỗi cú pháp JSON và không hiển thị bản dịch tiếng Việt cho câu tiếng Anh.
  - Khắc phục:
    1. Bổ sung `import { config } from "../app/config";` và cấu hình chính xác `${config.apiBaseUrl}/translations/instant` cho tất cả các hàm dịch tức thì và nút "Dịch ngay".
    2. Đảm bảo thuật toán phát hiện ngôn ngữ nhận diện đúng câu tiếng Anh $\rightarrow$ dịch sang tiếng Việt (`target="vi"`), câu tiếng Việt $\rightarrow$ dịch sang tiếng Anh (`target="en"`).
- **Chuẩn hóa nhận diện người nói bắt đầu từ "Người nói 1":**
  - Nguyên nhân: Speechmatics trả về nhãn người nói ban đầu là `"S2"` hoặc `"2"`. Thuật toán frontend trích xuất số và hiển thị thành `"Người nói 2"`, khiến người nói đầu tiên hoặc duy nhất trong cuộc họp luôn bị hiển thị sai thành `Người nói 2`.
  - Khắc phục:
    1. **Speechmatics Provider (`speechmatics.py`):** Bổ sung bộ ánh xạ nhãn thứ tự xuất hiện (`_speaker_map`): người nói đầu tiên xuất hiện luôn được chuẩn hóa thành `speaker_1`, người nói thứ hai thành `speaker_2` (giữ nguyên nhãn hồ sơ đã nhận diện `VP_...`).
    2. **Frontend (`MeetingPage.tsx` & `LiveMeetingPage.tsx`):** Cập nhật `speakerOrderMap` và `getSpeakerDisplay`: đảm bảo người nói đầu tiên luôn luôn mang danh xưng `Người nói 1`.
- **Tối giản hóa giao diện trạng thái chờ (Clean & Minimalist Loading UI):**
  - Loại bỏ hoàn toàn mô tả dài dòng và các badge bước 1, 2, 3 phức tạp.
  - Thay bằng thông báo ngắn gọn chuẩn UX: Tiêu đề `"Đang xử lý…"` và mô tả `"Vui lòng đợi trong giây lát."`.
- **Tách rời bóc băng trước, dịch thuật sau:**
  - Bóc băng xong chuyển trạng thái cuộc họp sang Hoàn tất (`COMPLETED`) ngay lập tức trong 2-3 giây.
  - Dịch thuật tự động chạy ngầm (`_background_auto_translate`) và cập nhật thời gian thực vào giao diện qua WebSocket broadcaster.

## Verification

- **Backend Tests:** Chạy `python -m pytest tests/test_speechmatics_provider.py tests/test_ai.py tests/test_media.py tests/test_realtime_speakers.py` $\rightarrow$ **Passed 42/42 tests (100%)**.
- **Frontend Build:** Chạy `npm run build` (`tsc --noEmit && vite build`) $\rightarrow$ **Build thành công 0 lỗi**.
