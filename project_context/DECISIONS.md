# Implementation Decisions

Đây là bản tóm tắt tham chiếu nhanh. Nguồn chi tiết vẫn là `docs/`.

- Frontend dùng React + TypeScript + Vite; API base URL và WebSocket URL lấy
  từ `VITE_API_BASE_URL` và `VITE_WS_BASE_URL`.
- Không đưa provider credential hoặc AI/provider logic vào frontend.
- Phân quyền theo meeting ACL: `read`, `comment`, `edit`, `owner`; owner là
  cấp duy nhất được quản lý chia sẻ/xóa meeting.
- Provider capability từ `GET /capabilities` quyết định UI cho streaming,
  diarization, language, summary và export. Không giả tính năng không được
  provider hỗ trợ.
- Tất cả thao tác async dùng job status do backend trả về; frontend không báo
  hoàn tất trước khi job đạt terminal state.
- Mỗi edit transcript tạo transcript version mới; không overwrite version cũ.
- Upload UI chỉ pre-check loại/size tệp. Backend vẫn là authority cho duration,
  codec và media validity.
- Auth dùng signed JWT access/refresh token vì ERD chưa có bảng session hoặc
  revocation. Logout chỉ hủy state phía client; thêm server-side revocation cần
  migration/session design riêng.
- OTP email/password reset được băm scrypt và chỉ delivery qua adapter đã cấu
  hình (hiện có SMTP); không dùng mock email khi chạy ứng dụng.
- Google OAuth dùng authorization-code flow, state cookie HttpOnly đã ký và chỉ
  chấp nhận verified email từ Google.
