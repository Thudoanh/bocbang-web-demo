# Implementation Decisions

Đây là bản tóm tắt tham chiếu nhanh. Nguồn chi tiết vẫn là `docs/`.

- Frontend dùng React + TypeScript + Vite; API base URL và WebSocket URL lấy
  từ `VITE_API_BASE_URL` và `VITE_WS_BASE_URL`.
- End còn enqueue recording_assembly cùng transaction completion, độc lập AI;
  worker trước provider factory ghép PCM chunks thành MediaFile WAV private.
  GET status chỉ đọc, POST edit cho completed realtime/khôi phục cũ/thử lại.
  Chống trùng bằng meeting/job locks; nguồn lỗi/overlap không publish partial,
  không làm meeting failed. Gaps giữa connections giữ timeline bằng silence
  kèm warning, không ghép kín mất timestamps. Không có audio thì không tái tạo.
- Nghe lại là nút thứ tám mở mini player ở toolbar host, không inline player
  lớn. No autoplay, native controls/speed/download, timestamp seek/play scoped
  events và highlight; close/Escape pause/return focus. Playback dùng URL TTL/
  Range thay blob tải hết khi mở, refresh giới hạn. Lưu bền qua reload; owner
  xóa băng tổng xóa cả raw chunks, giữ tombstone và cấm tự phục hồi. Không đổi
  ACL/share exposure, capture/STT/summary/polish hay schema/migration hiện tại.
- Bản ghi dùng header mỏng gồm nút sidebar, tên cuộc họp, metadata nhỏ và actions
  theo ACL; bỏ eyebrow/tiêu đề Bản ghi lặp. Header portal chỉ chuyển trình bày,
  không đổi vị trí/mount của workspace/controller. Nội dung sát header, full width.
- Sidebar desktop đóng hoàn toàn bằng visibility/CSS, nhớ localStorage riêng
  với fallback khi storage bị chặn; không unmount lịch sử/editor/bộ ghi. Nút
  mở luôn ở ngoài sidebar. Mobile drawer bắt đầu đóng, độc lập preference desktop,
  backdrop/Escape/focus trap/return/body-scroll cleanup và breakpoint reset.
  Toolbar căn theo biến sidebar-width=0 khi thu gọn, giữ clearance đo thực tế.
- Sidebar trái dành cho lịch sử cuộc họp/tạo mới/tải bản ghi; công cụ theo
  meeting nằm trên thanh dưới vùng làm việc. Mobile mở lịch sử bằng ngăn kéo.
  Mẫu giọng và Cài đặt nằm trong menu tài khoản.
- Bấm thương hiệu Bóc Băng hoặc mở `/`/`/meetings` luôn hiện form nhập tên
  ở giữa để tạo meeting; lịch sử quản lý riêng tại `/history` qua Xem tất cả.
  Không lặp CTA ghi âm/tải file ở main content; tùy chọn tạo nâng cao thu gọn.
  Theme sáng/tối chuyển vào Cài đặt → Giao diện, giữ localStorage/browser scope.
- Bản ghi một cột rộng: loại bỏ khung và tính năng giao diện Thông tin/Bình luận/
  Phiên bản, không chuyển thành nút/hộp thoại khác. Không tải comments/version
  lists trên trang này. Giữ API/data lịch sử và revision nội bộ phục vụ chỉnh sửa,
  làm mịn, summary/export; không xóa dữ liệu hoặc thay phân quyền hiện có.
- Quản lý các phiên có tên chuyển vào nút Phiên họp trên toolbar đáy, mở native
  dialog ở cùng trang. Không điều hướng/unmount bộ ghi hoặc gửi pause/stop khi
  mở/lưu/đóng; chỉ chọn Tạo phiên mới khi tạm dừng mới khép/tách phiên. Không tự mở hộp sau
  pause; hiển thị nhắc ngắn. Giữ read/edit ACL và PATCH rename hiện tại.
- Làm mịn chuyển vào nút toolbar thứ bảy, mở native dialog tại chỗ thay panel
  inline. Status hiển thị kể cả hộp đóng; không auto-open/auto-accept. Khóa khi
  chưa completed/không transcript, giữ read/edit ACL, nháp và expected revision.
  Auto AI sau end/backend/prompt không đổi; chốt mới cập nhật current transcript.
- Bản ghi bật dịch mới chia gốc trái/dịch phải 50/50; tắt thì gốc toàn chiều
  rộng. Mỗi logical segment một grid row chung để metadata/range/cặp câu không
  lệch khi text dài; không chèn dịch dưới lời gốc, không dùng hai list độc lập.
  Giữ transient realtime cache, placeholder khi chưa có kết quả/partial, không
  đổi STT/socket/pause/resume, API/provider hoặc saved translation workflow.
- Không đưa provider credential hoặc AI/provider logic vào frontend.
- Bỏ khung Ghi âm; start/pause/resume/end chuyển xuống toolbar icon-only, giữ
  đồng hồ/trạng thái và lỗi/cảnh báo khi có. End vẫn mở xác nhận; dịch
  hiện/ẩn ở bên phải Nội dung. Tooltip hover/focus, accessible labels, Escape,
  hit target 44px; Làm mịn dùng dấu trạng thái và tooltip đầy đủ. Portal chỉ phần
  trình bày vào host ổn định, không remount controller/socket. Toolbar tự xuống
  hàng, đo chiều cao bằng ResizeObserver để chừa khoảng transcript tương ứng.
- Toolbar chỉ là bố trí các nút độc lập, không có panel/nền/blur/shadow chung;
  từng nút tròn có surface/border/shadow nhẹ, timer chip bên trái. Khoảng trống
  click-through, tool/alert vẫn tương tác được. Routine feedback không chiếm
  hàng cố định, ở tooltip timer và live region; severity UI explicit giữ cả
  retryable error/reconnect/fallback/lỗi dịch hiện banner. Không đổi capture/
  socket/lifecycle/confirmation; giữ host và resize-based clearance.
- Thu giọng trước cuộc họp là tùy chọn. Thư ký gán tên và xác nhận đoạn âm thanh
  để tạo mẫu qua worker; lưu mẫu độc lập với cuộc họp nguồn và dùng lại theo
  owner/member scope. Không tự tạo voiceprint từ văn bản hay nhãn AI chưa xác nhận.
- Realtime lưu PCM16 WAV chunks theo timeline, không chỉ gửi STT; file upload
  dùng provenance transcript để lấy đúng âm thanh. Mẫu mới nạp vào upstream
  đang chạy bằng refresh, không hoàn tất meeting.
- Phân quyền theo meeting ACL: `read`, `comment`, `edit`, `owner`; owner là
  cấp duy nhất được quản lý chia sẻ/xóa meeting.
- Provider capability từ `GET /capabilities` quyết định UI cho streaming,
  diarization, language, summary và export. Không giả tính năng không được
  provider hỗ trợ.
- Tất cả thao tác async dùng job status do backend trả về; frontend không báo
  hoàn tất trước khi job đạt terminal state.
- Meeting có nhiều phiên tên/range trên PCM timeline. Pause explicit của UI
  hỏi Tạo phiên mới hoặc Chỉ tạm dừng; chỉ nhánh đầu gửi new_section:true,
  flush/đóng upstream rồi tạo pending next session; nhánh sau giữ phiên.
  Mở hộp chưa pause (ghi rõ còn ghi), Close/Escape là pause thường, focus mặc
  định nhánh an toàn và chống chọn lặp. ACK opt-in acknowledge:true cho plain
  pause/resume; default false giữ lệnh legacy. Không auto start phiên mới;
  resume ACK mới bật microphone. Chuyển công cụ/ngắt socket không chia phiên.
- UI summary mặc định scope=sessions, API thiếu field vẫn scope=meeting để
  tương thích client/job/output cũ. Mỗi phiên có AI input/output riêng; chụp cả
  text edit events/tên/range khi enqueue, không trộn context hoặc fake phiên trống.
- Tóm tắt phiên cho chọn nhiều checkbox (all/none), gửi section_ids + layout
  revision; phân nhóm với tất cả boundary rồi lọc, chỉ snapshot/gọi AI cho phiên
  đã chọn. Tập chọn khác tạo SummaryVersion mới, output cũ luôn giữ snapshot.
- Quản lý phiên cho thêm mốc nội bộ, sửa ranh giới liền kề, xóa có xác nhận
  rồi gộp vào phiên trước (đầu gộp sau); tối thiểu một phiên, giữ mốc đầu/cuối.
  Chỉ thay grouping, tuyệt đối không sửa/xóa transcript, audio, speaker hay
  summary cũ. Meeting lock + computed revision chống ghi đè stale; không migration.
- Meeting cũ không có boundary được backfill một phiên, không tự suy đoán chia
  hồi tố. Không ghi tiếp vào meeting completed; tiếp nối dùng pause/resume.
- Mỗi edit transcript tạo transcript version mới; không overwrite version cũ.
- Kết thúc meeting kích hoạt job làm mịn sau final STT flush; giữ snapshot
  gốc/AI-generated/nháp riêng trong job payload. Chỉ người dùng edit quyền chốt
  mới tạo transcript revision mới; kiểm tra source/draft revision chống ghi đè.
  Dùng LLM/fallback đang cấu hình, không tóm tắt và không tự quyết định bản đúng.
- Upload UI chỉ pre-check loại/size tệp. Backend vẫn là authority cho duration,
  codec và media validity.
- Auth dùng signed JWT access/refresh token vì ERD chưa có bảng session hoặc
  revocation. Logout chỉ hủy state phía client; thêm server-side revocation cần
  migration/session design riêng.
- OTP email/password reset được băm scrypt khi lưu DB. Delivery thật dùng SMTP;
  code hiện có console adapter in OTP plaintext ra API stdout cho local dev
  (development để trống provider, hoặc chọn console/dev/local). Public deployment
  cần cấu hình SMTP; console output không phải email delivery.
- Google OAuth dùng authorization-code flow, state cookie HttpOnly đã ký và chỉ
  chấp nhận verified email từ Google.
