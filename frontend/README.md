# Bóc Băng AI frontend

Frontend đang dùng React + TypeScript + Vite, gọi REST/WebSocket FastAPI thật.
Source nằm trong `src/`; `../prototype/` chỉ là tham chiếu giao diện cũ.

Nghe lại là công cụ thứ tám (icon volume), mở trình nghe nhỏ phía trên toolbar,
không có player lớn trên transcript. Realtime sau end tự tổng hợp băng ở worker;
hiện pending/ready/error thật, mở không tự phát. Có play/pause/tua/thời gian/
tốc độ/tải xuống; đóng/Escape pause và trả focus. Bấm timestamp mở/tua/phát và
highlight đoạn đang nghe. Reload vẫn đọc băng đã lưu; URL phát có TTL/Range được
làm mới khi cần, không tải blob toàn bộ băng chỉ để mở player.
Meeting cũ còn audio có nút Chuẩn bị băng theo quyền edit; không có audio hoặc
đã xóa báo đúng trạng thái, không fake băng từ chữ. Xem [luồng lưu/phát](../docs/architecture/recording-playback.md).

Trang Bản ghi dùng thanh đầu gọn: nút sidebar, tên cuộc họp và metadata nhỏ,
Đổi tên/Chia sẻ theo ACL; không lặp nhãn/tiêu đề Bản ghi lớn. Header presentation
portal vào host ổn định, transcript dùng toàn chiều rộng với padding-top 12px.
Sidebar có nút đóng/mở ở ngoài sidebar trên mọi trang authenticated. Máy tính
ghi nhớ thu gọn trong localStorage (`bocbang-sidebar-collapsed`); chặn storage
vẫn thao tác được trong bộ nhớ. Mobile luôn bắt đầu đóng, mở drawer riêng,
backdrop/Escape, giữ focus và hoàn trả scroll/focus khi đóng/đổi breakpoint.
Thu gọn chỉ đổi CSS/visibility, không unmount nội dung/editor/bộ ghi. Toolbar
căn theo sidebar width thực (0 khi thu gọn), vẫn đo chiều cao để chừa nội dung.

Không còn khung Ghi âm phía trên transcript. Start/pause/resume/end nằm trên
toolbar đáy bằng biểu tượng; đồng hồ/trạng thái và thông báo lỗi vẫn đọc được
thường trực. End vẫn cần xác nhận. Tên công cụ hiện khi hover/focus bàn phím,
Escape ẩn tooltip; nút tối thiểu 44px. Nút Hiển thị/Ẩn bản dịch nằm bên phải
tiêu đề Nội dung. RecordingPanel giữ nguyên lifecycle trong trang, chỉ portal
phần trình bày vào host ổn định của AppShell, không khởi tạo lại microphone/socket.

Toolbar không có khung/nền/bóng/blur chung: từng nút tròn có nền/viền/bóng nhẹ
riêng, đồng hồ/trạng thái là cụm nhỏ bên trái. Khoảng trống giữa nút cho phép
click nội dung phía dưới, vẫn giữ hit target 44px và tooltip hover/focus/Escape.
Thông báo thường (kể cả hoàn tất/dịch thành công) ở tooltip đồng hồ và live
region screen reader, không chiếm hàng cố định. Chỉ lỗi/cảnh báo hiện banner
riêng có nền tương phản, bao gồm retryable error, reconnect, fallback và lỗi dịch.
ResizeObserver vẫn đo chiều cao khi banner xuất hiện hoặc toolbar xuống hàng.

Bấm Phiên họp trên thanh công cụ dưới để mở hộp quản lý tên/range/trạng thái,
không chuyển trang hoặc ngắt microphone. Không còn khung phiên nằm trên
transcript. Tạm dừng mở hộp chọn Tạo phiên mới hoặc Chỉ tạm dừng; chỉ lựa chọn
đầu tạo phiên tiếp theo đang chờ và nhắc mở Phiên họp để đặt tên (không tự mở
hộp quản lý). Lựa chọn sau giữ phiên; đóng/Escape cũng chỉ tạm dừng. Ghi âm còn
chạy trong lúc chờ chọn, hộp ghi rõ và mặc định focus nhánh không tạo phiên.
Cả hai nhánh flush microphone và chờ máy chủ; Tiếp tục chờ ACK mới thu lại.
Trang Tóm tắt mặc định Từng phiên họp, có card kết quả/sửa riêng
và lựa chọn Toàn cuộc họp để đọc bản cũ. Xem [luồng phiên](../docs/architecture/meeting-sessions.md).

Sau khi kết thúc, AI vẫn tự làm mịn khi khả dụng, nhưng không có khung duyệt
phía trên transcript. Nút Làm mịn trên thanh công cụ hiển thị đang xử lý/chờ
duyệt/đã chốt/lỗi; bấm mở hộp để đối chiếu gốc, sửa/lưu nháp và chốt trước khi
transcript hiện tại thay đổi. Không tự mở hộp hoặc tự chốt kết quả.

Trong Bản ghi, chưa bật dịch thì transcript gốc chiếm toàn chiều rộng. Bật
Dịch trực tiếp chia nội dung thành hai cột bằng nhau: Transcript gốc trái,
Bản dịch phải. Các đoạn ghép theo logical ID, chung chiều cao hàng/vùng cuộn,
cùng người nói/mốc thời gian; partial/chưa có kết quả hiện placeholder trung
thực. Không còn bản dịch chèn dưới lời gốc. Ẩn quay về một cột, giữ cache đã
nhận để hiện lại trong lần mở trang hiện tại, kể cả sau end. Cache realtime
vẫn không persist/recover qua reload; không đổi saved-translation workflow.
Không gọi HTTP complete song song với socket stop. Xem
[lifecycle và acceptance](../docs/architecture/transcript-polish.md).

## Chạy trên host

Cần Node.js/npm (Docker build hiện dùng Node 22), API ở port 8000 và backend
đã cấu hình database/auth/provider. Từ thư mục `frontend/`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run dev
```

Mở `http://localhost:5173`. Vite đọc `frontend/.env`, không đọc root `.env`.
`VITE_API_BASE_URL`/`VITE_WS_BASE_URL` gồm prefix `/api/v1`; giới hạn upload
dùng `VITE_MAX_UPLOAD_BYTES`/`VITE_MAX_MEDIA_DURATION_SECONDS`. Xem
[cấu hình môi trường](../docs/deployment/environment.md). Provider key, JWT
secret, database URL và OAuth client secret chỉ nằm phía backend.

Để chạy toàn bộ bằng Docker, làm theo [README root](../README.md); không cần
`frontend/.env`. Compose phục vụ bundle đã build bằng Nginx, source thay đổi
cần rebuild. Dừng service frontend Compose trước khi chạy Vite cùng port 5173.

## Routes và chức năng

| Route | Chức năng |
| --- | --- |
| `/`, `/meetings` | Trang chủ tối giản: nhập tên và Enter/nút mũi tên để tạo cuộc họp realtime. |
| `/login`, `/register`, `/forgot-password` | Auth, OTP, recovery và Google handoff. |
| `/meetings/create?mode=upload` | Tạo cuộc họp upload; bỏ `mode=upload` để tạo realtime. |
| `/meetings/:id` | Bản ghi một cột rộng: thu PCM16 mono 16 kHz qua AudioWorklet; start/pause/resume/stop, dịch realtime tạm, sửa transcript, nghe băng realtime/upload qua toolbar và seek theo đoạn. |
| `/meetings/:id/upload` | Upload và theo dõi job thật. |
| `/meetings/:id/speakers` | Sửa metadata người nói, nghe sample interval khi có media. |
| `/meetings/:id/translation` | Dịch segment VI ↔ EN được lưu. |
| `/meetings/:id/summary` | Chọn mẫu có sẵn hoặc nhập prompt tùy chỉnh, chọn VI/EN và sửa kết quả thành phiên bản mới. |
| `/meetings/:id/export-share` | Export sáu format, thành viên ACL và share link. |
| `/history` | Danh sách quản lý: tìm/lọc, mở bản ghi, owner xóa meeting/media. Mở bằng Xem tất cả ở sidebar. |
| `/settings` | Giao diện sáng/tối lưu trên trình duyệt; sửa full name, đăng ký/thêm/xóa mẫu giọng cá nhân. |
| `/share/:token` | Public read-only metadata + transcript qua capability token. |

Auth route dùng chung `AuthPage`; routing dùng `window.location` và match
pathname trong `App.tsx`, chưa dùng thư viện router. Host static cần SPA
fallback để mở deep link; `nginx.conf` đã cấu hình cho Docker.

Sidebar trái hiển thị lịch sử meeting từ API theo quyền truy cập, nhóm theo ngày,
tìm kiếm và tải thêm mỗi 50 meeting. Đổi tên/xóa/hoàn tất cập nhật lại lịch sử.
Các công cụ Bản ghi, Phiên họp, Làm mịn, Tóm tắt, Người nói, Bản dịch và Xuất nằm trên thanh cố định
ở đáy vùng làm việc của meeting. Mobile dùng ngăn kéo lịch sử bên trái và cùng
thanh công cụ đáy. Mẫu giọng/Cài đặt nằm trong menu tài khoản; `Xem tất cả` mở
danh sách quản lý riêng tại `/history`. Bấm thương hiệu Bóc Băng luôn về trang
nhập tên, không mở danh sách. Các nút khởi tạo ghi âm/tải bản ghi chỉ ở sidebar;
form tạo có một nút mũi tên/Enter theo nguồn đã chọn. Ghi chú, ngôn ngữ và chế
độ người nói nằm trong Tùy chọn cuộc họp thu gọn. Tạo realtime mở Bản ghi; chỉ
bắt đầu thu microphone khi người dùng thao tác trong Bản ghi, không tự thu ở
trang chủ. Công tắc sáng/tối nằm trong Cài đặt → Giao diện, không nổi ở góc
workspace; theme vẫn được lưu qua localStorage như trước.

Trang Bản ghi không còn khung Thông tin/Bình luận/Phiên bản, nút mở thay thế
hay badge số version. Recording/player dùng một cột; vùng transcript chỉ tách
gốc/dịch 50/50 khi bật dịch, không giữ khoảng trống bên phải khi tắt. Các phần
trong vùng làm việc giữ nguyên. Phiên họp là nút mở native dialog bên cạnh workspace, không
thay thế/unmount bộ ghi; tải dữ liệu khi mở, cập nhật theo sự kiện phiên của
đúng meeting, Escape/Đóng trả focus và cảnh báo nháp chưa lưu. Read chỉ xem,
edit/owner được đổi tên; lỗi API giữ tên đã nhập. Không còn gọi API comments/version list từ
trang này. Lịch sử, cơ chế tạo revision và API backend vẫn giữ nguyên cho tính
toàn vẹn dữ liệu, summary/export và tương thích; không xóa dữ liệu cũ hay ACL.

Làm mịn là nút mở native dialog qua portal, không chuyển trang. Một controller
chung giữ job/draft/status khi hộp đóng, poll job đang chạy và làm mới theo sự
kiện/focus. Khóa khi chưa kết thúc/chưa có transcript, có lý do hiển thị; read
chỉ xem kết quả đã có, edit/owner mới tạo/sửa/chốt. Lỗi không xóa nháp; có cảnh
báo khi đóng với sửa chưa lưu. Chốt phát sự kiện scoped để Bản ghi tải current
transcript mới. Tám công cụ dùng biểu tượng, dấu trạng thái làm mịn và tooltip
đầy đủ trạng thái/lý do khóa. Toolbar flex tự xuống hàng trên màn hình hẹp;
ResizeObserver đo chiều cao thật để chừa khoảng nội dung, kể cả khi có cảnh
báo dài. Không đổi AI prompt/backend/API hoặc migration.

## Source và kiểm tra

- `src/api`: endpoint typed, HTTP client và auth-aware requests.
- `src/auth`: access/refresh session, OTP và Google handoff.
- `src/realtime`: socket reconnect, microphone capture/resampling, PCM worklet.
- `src/state`: polling job; `src/hooks`: async state.
- `src/pages`: màn hình theo route; `src/components`: shell, UI, enrollment modal.
- `src/types`, `src/utils`: domain type, time và permission helpers.
- `src/app`: app config, routes và stylesheet.

```powershell
npm run check
npm run build
npm run preview
node --experimental-strip-types --test tests/route.test.ts tests/liveTranscript.test.ts tests/meetingLanding.test.mjs tests/meetingWorkspace.test.mjs tests/transcriptPolish.test.ts
```

`build` chạy TypeScript check rồi Vite build; output là `dist/`. Chưa có npm
test/E2E script. Build thành công không chứng minh microphone, provider hay
playback đã qua browser E2E. Public share chưa cho comment/edit qua token và
chưa hiển thị summary/translation/media. Audio player cần media đã upload;
realtime capture lưu các WAV nhỏ theo timeline để nghe đoạn được chọn và học
giọng, chưa có player/tệp tổng hợp toàn bộ realtime audio.

Trong Bản ghi, dùng `Gán tên / Lưu giọng` để thư ký xác nhận người nói. Có thể
chọn nhiều đoạn cùng người (ít nhất 10 giây, tối đa lấy 25 giây), nghe lại và
tạo/bổ sung hồ sơ giọng nói. `Chỉ gán tên` không tạo mẫu. Tác vụ học chạy qua
worker, cuộc họp vẫn tiếp tục; khi thành công frontend nạp mẫu mới vào phiên
đang chạy. Mẫu được dùng lại trong các cuộc họp có quyền truy cập phù hợp.
Xem [luồng học giọng](../docs/architecture/meeting-voice-learning.md).
