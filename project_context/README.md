# Project Context

Thư mục này là điểm handoff ngắn gọn cho mọi agent làm việc trong repo.
Nó không thay thế tài liệu kiến trúc trong `docs/`; nó chỉ ghi nhận trạng
thái thực thi và những thông tin cần đọc trước khi bắt đầu một task.

## Đọc theo thứ tự

1. `CURRENT_STATUS.md` — task đang làm, blocker và next task.
2. `DECISIONS.md` — các quyết định thực thi cần tôn trọng.
3. Tài liệu domain phù hợp trong `docs/`.
4. `TASK_LOG.md` — các task đã hoàn tất gần đây.

## Quy tắc cập nhật

Sau khi hoàn thành **mỗi task có thay đổi repo**, agent phải:

1. cập nhật `CURRENT_STATUS.md` (done / doing / next / blocker);
2. thêm một mục vào đầu `TASK_LOG.md`, gồm ngày, phạm vi thay đổi, file
   chính, cách xác minh và blocker còn lại nếu có;
3. cập nhật `DECISIONS.md` chỉ khi phát sinh quyết định mới hoặc thay đổi
   quyết định đã chốt;
4. không ghi secret, token, PII, hay output log dài vào các file này.

Nếu task chỉ là trả lời hoặc kiểm tra read-only, không cần thêm log. Khi một
task không thể hoàn tất, cập nhật `CURRENT_STATUS.md` với blocker thay vì ghi
nó là completed.
