# Task Log

Mục mới nhất được thêm ở đầu file. Dùng format ngắn dưới đây:

```md
## YYYY-MM-DD — Tên task

- Status: done | blocked
- Scope: ...
- Changed: `path/file`, ...
- Verified: ...
- Follow-up / blocker: ...
```

## 2026-11-02 — Khắc phục Missing chunk index 0, Chuẩn hóa Người nói 1 & Sửa URL dịch tức thì

- Status: done
- Scope:
  1. **Khắc phục triệt để lỗi "Missing chunk index 0" khi tải tệp:**
     - Frontend (`frontend/src/api/client.ts`): Áp dụng Direct Single Streaming Upload cho tất cả các file âm thanh $\le 100\text{MB}$ gửi trực tiếp vào `/meetings/{id}/media` (vốn hỗ trợ sẵn streaming to disk và Ingress cho phép 600m). Triệt tiêu hoàn toàn rủi ro thiếu chunk do mạng hay định tuyến Kubernetes. Với tệp siêu lớn (> 100MB), tăng kích thước chunk lên 10MB.
     - Backend (`backend/app/services/media.py`): Chuẩn hóa tìm kiếm chunk đa vị trí (`candidate_dirs`), đồng thời dùng `destination.flush()` và `os.fsync()` đảm bảo dữ liệu ghi đĩa vật lý xong trước khi xác nhận chunk.
  2. **Khắc phục lỗi dịch thuật tiếng Anh ("Chưa có bản dịch [Dịch ngay]"):**
     - Sửa đường dẫn tương đối `/api/v1/translations/instant` trong `frontend/src/pages/MeetingPage.tsx` thành `${config.apiBaseUrl}/translations/instant` (tránh bị Nginx trả về `index.html`).
     - Đảm bảo câu tiếng Anh tự động dịch sang tiếng Việt (`target="vi"`) và câu tiếng Việt tự động dịch sang tiếng Anh (`target="en"`).
  3. **Chuẩn hóa nhận diện người nói bắt đầu từ "Người nói 1":**
     - Tại Speechmatics Provider (`speechmatics.py`): Chuẩn hóa các nhãn người nói generic từ Speechmatics (như `S2`, `2`, `UUID`) thành thứ tự xuất hiện `speaker_1`, `speaker_2` (giữ nguyên nhãn hồ sơ mẫu giọng `VP_...`).
     - Tại Frontend (`MeetingPage.tsx`, `LiveMeetingPage.tsx`): Áp dụng `speakerOrderMap` đảm bảo người nói đầu tiên luôn hiển thị là `Người nói 1`.
- Changed: `frontend/src/api/client.ts`, `backend/app/services/media.py`, `backend/app/providers/speechmatics.py`, `frontend/src/pages/MeetingPage.tsx`, `frontend/src/pages/LiveMeetingPage.tsx`, `project_context/CURRENT_STATUS.md`, `project_context/TASK_LOG.md`.
- Verified: Backend pytest pass 42/42 tests; frontend build pass 0 errors.
- Follow-up / blocker: Commit và push lên `origin/dev_new` để kích hoạt CI/CD deploy lên staging server `http://htm.democloud.xyz`.

## 2026-11-02 — Sửa lỗi tải file tiếng Anh, Tách rời Bóc băng trước & Dịch sau, Tối giản giao diện

- Status: done
- Scope:
  1. **Khắc phục triệt để lỗi tải file audio tiếng Anh:** Tích hợp nhận diện ngôn ngữ tự động qua Groq Whisper Turbo (`whisper-large-v3-turbo` trong 1.5s), tự động truyền đúng mã ngôn ngữ `"en"` sang Speechmatics Batch STT, đồng thời thêm cơ chế tự động thử lại (safe auto-retry) với `"en"` nếu Speechmatics gặp lỗi hoặc trả về rỗng khi quét `"vi"`. Bổ sung tùy chọn ngôn ngữ rõ ràng trên UI tải tệp (`Tự động nhận diện (VI / EN)`, `Tiếng Việt`, `Tiếng Anh`).
  2. **Tách rời bóc băng trước và dịch thuật sau (Decoupled Upload Pipeline):** Bóc băng xong là mở khóa màn hình tải tệp và hoàn tất job ngay lập tức trong 1.5 – 3 giây (độ trễ = 0). Tác vụ dịch thuật song ngữ chạy ngầm hoàn toàn bất đồng bộ (`_background_auto_translate`) và cập nhật realtime vào giao diện cuộc họp, không làm chậm hay giữ chân người dùng.
  3. **Tối giản hóa thông báo chờ:** Xóa bỏ toàn bộ đoạn text dài dòng phức tạp ("Đang bóc băng siêu tốc & nhận diện người nói...", các badge bước 1, 2, 3), thay thế bằng thông báo ngắn gọn: `"Đang xử lý… Vui lòng đợi trong giây lát."`.
- Changed: `backend/app/services/media_worker.py`, `frontend/src/pages/MeetingPage.tsx`, `frontend/src/pages/MeetingsPage.tsx`, `project_context/CURRENT_STATUS.md`, `project_context/TASK_LOG.md`.
- Verified: Backend pytest pass 42/42 tests; frontend build pass 0 errors; Groq Whisper tự động nhận diện ngôn ngữ `"en"` và `"vi"`.
- Follow-up / blocker: Push lên `origin/dev_new` để kích hoạt CI/CD deploy lên server.
