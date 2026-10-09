# Audit UI/UX — Bóc Băng AI

> Báo cáo lịch sử trước các cập nhật UI tiếp theo; không dùng các issue bên dưới
> làm backlog hiện tại khi chưa đối chiếu source. Rà soát ngày 2026-10-08 đã thấy
> routes login/register/forgot-password/create, player đồng bộ transcript,
> speaker sample, split timestamp và public transcript có implementation.
> Voice profile/Speechmatics enrollment và summary output language cũng đã có.
> Việc cập nhật chú thích này là source review, không phải browser/visual QA mới.
> Trạng thái hiện tại: [Current Status](../project_context/CURRENT_STATUS.md),
> [QA checklist](planning/phase-4-qa.md).

## 1. Tổng quan

Qua quá trình đối chiếu toàn bộ **Tài liệu nghiệp vụ BA (BocBang_AI_BA.docx.md)**, **Tài liệu thiết kế giao diện (UI/Screen/State Specs)**, **Source code frontend hiện tại (React/TypeScript)** và **Giao diện thực tế đang chạy trên web demo (http://localhost:5173)**:

- **Mức độ đáp ứng nghiệp vụ cốt lõi:** Frontend hiện tại đã dựng được khung ứng dụng web hoàn chỉnh, kết nối với backend API cho các luồng nghiệp vụ như đăng nhập/đăng ký, tạo cuộc họp, bóc băng realtime qua WebSocket, upload file audio/video, xem & biên tập transcript, phân định speaker, dịch thuật song ngữ, tóm tắt AI, xuất file (PDF/DOCX/TXT/SRT/VTT/JSON) và quản lý lịch sử cuộc họp.
- **Những điểm tồn tại chính:**
  1. **BA Mismatch (Bất đồng bộ với yêu cầu BA):** Các luồng như Đăng ký, Quên mật khẩu, Tạo cuộc họp mới bị dồn chung làm mất route riêng theo BA Spec (`/register`, `/forgot-password`, `/meetings/create`); Nút "Tải lên bản ghi" ở Sidebar hoạt động chưa đúng ngữ cảnh; Chức năng "Nghe mẫu giọng người nói" (Voice Sample) trong Quản lý người nói bị thiếu; Màn hình Tách đoạn (Split) chưa cho chọn mốc thời gian cắt cụ thể; Trang chia sẻ công khai (`/share/:token`) chỉ hiển thị metadata mà chưa hiển thị transcript.
  2. **Technical & UI Implementation Issue:** Thanh phát audio (`PersistentPlayerBar`) bị vô hiệu hóa hoàn toàn ("Audio chưa sẵn sàng"), chưa đồng bộ vị trí phát với các đoạn transcript; Các nhãn trạng thái (Status badge) bị hiển thị dạng chuỗi enum tiếng Anh nguyên bản (`recording`, `processing`, `completed`, `failed`); Thiếu bước xác nhận (Confirmation dialog) cho các thao tác tác động lớn như Tách/Gộp đoạn.
  3. **UX & Visual Refinement (Dấu hiệu AI-generated / vibe-coded):** Giao diện bị lạm dụng quá nhiều viền mỏng (card/panel borders), bố cục hai cột bị gượng ép ở nhiều màn hình, màn hình Chi tiết cuộc họp (`/meetings/:id`) bị ôm đồm quá nhiều box panel phụ làm nhiễu thị giác, topbar chứa nhiều chi tiết trang trí không có tính năng thực tế.

---

## 2. Requirement Traceability Matrix

| Requirement | Tham chiếu BA | UI hiện tại | Trạng thái | Vấn đề phát hiện |
| :--- | :--- | :--- | :--- | :--- |
| **Đăng nhập** | Sec C.2.1 | `AuthPage.tsx` (`mode === 'login'`) | **PASS** | Hỗ trợ email/password, OTP, Google auth trigger, chuyển luồng quên mật khẩu. |
| **Đăng ký** | Sec C.2.2 | `AuthPage.tsx` (`mode === 'register'`) | **PARTIAL** | Gộp chung trong `AuthPage`, thiếu route `/register` riêng; chưa có đủ các trường thông tin công ty/phòng ban như thiết kế BA. |
| **Quên/Đặt lại mật khẩu** | Sec C.2.3 | `AuthPage.tsx` (`mode === 'forgot'/'reset'`) | **PARTIAL** | Hoạt động bằng chuyển state nội bộ, thiếu route `/forgot-password` và `/reset-password` riêng biệt. |
| **Danh sách cuộc họp** | Sec C.1, C.12 | `MeetingsPage.tsx`, Sidebar | **PASS** | Hiển thị danh sách cuộc họp gần đây, metadata thời lượng, ngôn ngữ, quyền truy cập. |
| **Tìm kiếm cuộc họp** | Sec C.1, C.12 | `HistoryPage.tsx`, Sidebar | **PARTIAL** | Ô tìm kiếm tại `/history` chạy tốt; ô tìm kiếm tại Sidebar chỉ là UI tĩnh chưa lọc thực sự. |
| **Tạo phiên họp** | Sec C.3 | `MeetingsPage.tsx` | **PARTIAL** | Nằm chung tại route `/meetings`, chưa có màn hình/route riêng `/create-meeting` kèm panel hướng dẫn quy trình như BA Spec. |
| **Ghi âm realtime** | Sec C.4 | `MeetingPage.tsx` (`RecordingPanel`) | **PASS** | Bắt microphone, kết nối WebSocket, hiển thị partial & final transcript, đồng hồ đếm giờ. |
| **Trạng thái ghi âm** | Sec D.1 | `RecordingPanel` | **PASS** | Hiển thị các trạng thái: Đang kết nối, Đang ghi âm, Tạm dừng, Đang hoàn tất, Thất bại. |
| **Tải lên audio/video** | Sec C.5 | `UploadPage.tsx` | **PASS** | Kéo thả/chọn file, kiểm tra định dạng và dung lượng tối đa (MB/giờ). |
| **Trạng thái xử lý file** | Sec D.1 | `UploadPage.tsx`, `useJobMonitor` | **PASS** | Hiển thị tiến độ %, trạng thái Processing, Completed, Failed và thông báo lỗi. |
| **Xem transcript** | Sec C.6 | `MeetingPage.tsx` | **PASS** | Hiển thị danh sách đoạn, speaker, timestamp `start_ms` - `end_ms`, độ tin cậy. |
| **Playback audio** | Sec C.6 | `AppShell.tsx` (`PersistentPlayerBar`) | **CONFLICT** | Thanh player ở footer bị vô hiệu hóa ("Audio chưa sẵn sàng"), không phát được media thực tế, không sync timeline với transcript. |
| **Timestamp** | Sec C.6, C.7 | `MeetingPage.tsx` | **PASS** | Hiển thị thời gian dạng `mm:ss`; hỗ trợ sửa mốc thời gian trong mode Edit. |
| **Speaker** | Sec C.6, C.8 | `MeetingPage.tsx`, `SpeakersPage.tsx` | **PARTIAL** | Đã hỗ trợ gán/đổi speaker cho segment; **thiếu nút nghe mẫu giọng (voice sample player)** theo BA Sec C.8. |
| **Chỉnh sửa transcript** | Sec C.7 | `MeetingPage.tsx` | **PASS** | Sửa văn bản, sửa timestamp, đổi người nói, lưu tạo phiên bản mới. |
| **Tách đoạn (Split)** | Sec C.7 | `MeetingPage.tsx` | **PARTIAL** | Chỉ tự động chia đôi mốc thời gian `(start+end)/2`, **thiếu ô chọn/điều chỉnh mốc thời gian cắt cụ thể** và thiếu modal xác nhận. |
| **Gộp đoạn (Merge)** | Sec C.7 | `MeetingPage.tsx` | **PASS** | Cho phép gộp 2 đoạn liền kề và tạo phiên bản transcript mới. |
| **Xóa đoạn (Delete)** | Sec C.7 | `MeetingPage.tsx` | **PASS** | Cho phép xóa segment, có modal xác nhận trước khi thực hiện. |
| **Quản lý người nói** | Sec C.8 | `SpeakersPage.tsx` | **PARTIAL** | Cho phép thêm/sửa thông tin speaker (tên, vai trò, tổ chức); **thiếu voice sample player** để nghe kiểm tra giọng. |
| **Dịch transcript** | Sec C.9 | `TranslationPage.tsx` | **PASS** | Dịch song ngữ theo segment, bảo tồn bản gốc và bản dịch riêng biệt. |
| **Tóm tắt AI / Biên bản** | Sec C.10 | `SummaryPage.tsx` | **PASS** | Hỗ trợ các mẫu (General, Briefing, Voting), hiển thị các mục biên bản và nút Sao chép. |
| **Export** | Sec C.11 | `ExportSharePage.tsx` | **PASS** | Hỗ trợ PDF, DOCX, TXT, SRT, VTT, JSON; có tùy chọn kèm timestamp, speaker, bản dịch, tóm tắt. |
| **Share** | Sec C.11 | `ExportSharePage.tsx`, `SharePage.tsx` | **PARTIAL** | Tạo link chia sẻ theo quyền (read/comment/edit) OK; trang `/share/:token` chỉ hiển thị metadata, thiếu xem nội dung transcript. |
| **Lịch sử** | Sec C.12 | `HistoryPage.tsx` | **PASS** | Tìm kiếm, lọc theo trạng thái, lọc theo nguồn (realtime/upload), mở cuộc họp. |
| **Quản lý dữ liệu** | Sec C.12 | `HistoryPage.tsx` | **PASS** | Cho phép xóa tệp audio riêng hoặc xóa toàn bộ cuộc họp có confirmation modal. |
| **Profile/Settings** | Sec C.13 | `SettingsPage.tsx` | **PARTIAL** | Xem/sửa tên, email; thiếu đổi mật khẩu trực tiếp, thiếu cấu hình ngôn ngữ/diarization mặc định. |
| **Loading state** | Sec D.1, E.10 | TOÀN HỆ THỐNG | **PASS** | Hiển thị spinner và nhãn thông báo loading nhất quán. |
| **Error state** | Sec D.1, E.10 | TOÀN HỆ THỐNG | **PASS** | Hiển thị khung Failure và thông báo lỗi từ API rõ ràng. |
| **Empty state** | Sec D.1 | TOÀN HỆ THỐNG | **PASS** | Hiển thị giao diện rỗng kèm hình ảnh/icon, thông điệp và gợi ý hành động. |
| **Confirmation dialog** | Sec B.2, D.2 | `MeetingPage`, `HistoryPage` | **PARTIAL** | Đã có modal xác nhận cho thao tác xóa cuộc họp/xóa đoạn; thiếu modal xác nhận cho thao tác Tách/Gộp đoạn. |

---

## 3. Audit theo từng màn hình

### 3.1. Màn hình Đăng nhập / Đăng ký / Quên mật khẩu (`AuthPage.tsx`)
- **Mục đích:** Xác thực người dùng, đăng ký tài khoản mới và phục hồi mật khẩu.
- **Requirement BA:** Phải có 3 luồng rõ ràng với form riêng, hỗ trợ đăng nhập Google, gửi/xác minh OTP, nhập thông tin cá nhân/doanh nghiệp.
- **Hiện trạng:** Được gộp chung trong component `AuthPage.tsx` và chuyển đổi qua lại bằng React state (`mode`).
- **Điểm phù hợp:** Đã hỗ trợ đủ logic API cho Đăng nhập, Đăng ký, Nhập OTP, Quên mật khẩu, Đặt lại mật khẩu và Google OAuth button.
- **Điểm chưa phù hợp:** 
  - Thiếu Route/URL riêng biệt như `/login`, `/register`, `/forgot-password`. Người dùng không thể bookmark hoặc quay lại trang bằng nút Back trên trình duyệt.
  - Màn Đăng ký thiếu một số trường thông tin theo BA Spec (như Tên công ty/Phòng ban).
- **Vấn đề UX:** Khi chuyển đổi giữa các mode, lỗi hiển thị (`error`) bị giữ lại nếu không xóa thủ công; giao diện dồn hết vào một card cố định làm cho form Đăng ký bị chật chội.
- **Đề xuất:** Tách `AuthPage` thành các route/page độc lập hoặc sử dụng URL query params để quản lý luồng rõ ràng.

### 3.2. Màn hình AppShell & Sidebar Navigation (`AppShell.tsx`)
- **Mục đích:** Khung ứng dụng dùng chung, chứa Sidebar điều hướng và Topbar.
- **Requirement BA:** Sidebar chứa Logo, nút "Tạo phiên họp mới", nút "Tải lên bản ghi", Ô tìm kiếm, Danh mục cuộc họp gần đây, Nhóm Công cụ & Quản lý, và Khối hồ sơ cá nhân ở góc dưới.
- **Hiện trạng:** Đã dựng đúng bố cục Sidebar và Topbar.
- **Điểm phù hợp:** Danh mục cuộc họp gần đây tải dữ liệu thực từ API; hiển thị avatar chữ cái đầu của người dùng; điều hướng linh hoạt giữa các công cụ khi đang ở trong context của một cuộc họp.
- **Điểm chưa phù hợp:** 
  - Nút "Tải lên bản ghi" ở Sidebar hiện lấy href động (`/meetings/:id/upload` hoặc meeting gần nhất), không cho phép tạo một cuộc họp mới bằng cách upload file trực tiếp từ Sidebar.
  - Ô tìm kiếm ở Sidebar là input tĩnh, không trigger lọc cuộc họp.
  - Topbar chứa các biểu tượng Setting/Profile và nhãn "Sẵn sàng kết nối" dạng trang trí, không có tương tác click.
- **Vấn đề UX:** Người dùng muốn upload file cho cuộc họp mới từ Sidebar bắt buộc phải bấm "Tạo phiên họp mới" trước, tạo luồng thao tác dư thừa.
- **Đề xuất:** Sửa nút "Tải lên bản ghi" ở Sidebar trỏ trực tiếp đến luồng tạo cuộc họp mới bằng file upload (`/meetings/create?mode=upload`).

### 3.3. Màn hình Tạo phiên họp mới (`MeetingsPage.tsx`)
- **Mục đích:** Nhập thông tin ban đầu (Tên, Mô tả, Ngôn ngữ, Chế độ người nói) để bắt đầu cuộc họp.
- **Requirement BA:** Màn hình tạo phiên họp riêng biệt (`references/05-create-meeting.png`), có card nhập liệu bên trái và panel hướng dẫn quy trình bên phải.
- **Hiện trạng:** Form tạo cuộc họp nằm ở nửa trên của trang `/meetings`, nửa dưới là danh sách cuộc họp gần đây.
- **Điểm phù hợp:** Đã có đầy đủ các trường nhập Tên, Mô tả, Chọn Ngôn ngữ (vi/en), Chọn Phân biệt người nói (true/false) và 2 nút bấm chuyển luồng ("Tạo để tải tệp" & "Đến màn ghi âm").
- **Điểm chưa phù hợp:** 
  - Mâu thuẫn với BA Spec về cấu trúc route: BA yêu cầu màn hình riêng `/create-meeting`. Việc gộp chung danh sách cuộc họp ở dưới làm cho trang bị kéo dài và mất tập trung vào nhiệm vụ tạo cuộc họp.
- **Vấn đề UX:** Hai nút action "Tạo để tải tệp" và "Đến màn ghi âm" đứng cạnh nhau có visual hierarchy tương đương, dễ gây phân vân cho người dùng mới.
- **Đề xuất:** Tách luồng Tạo phiên họp ra route riêng `/meetings/create` hoặc hiển thị dưới dạng Modal/Drawer tập trung.

### 3.4. Màn hình Chi tiết phiên họp & Realtime Transcript (`MeetingPage.tsx`)
- **Mục đích:** Xem transcript, ghi âm trực tiếp, nghe lại audio, và thực hiện các thao tác biên tập (sửa, tách, gộp, xóa, đổi speaker).
- **Requirement BA:** Hiển thị transcript dạng danh sách xếp dọc; mỗi đoạn có speaker, timestamp, độ tin cậy; thanh phát audio phía dưới sync với transcript; panel bên phải chứa thông tin cuộc họp và tóm tắt nhanh.
- **Hiện trạng:** Đã triển khai tại `/meetings/:id` với đầy đủ tính năng biên tập transcript và ghi âm realtime qua WebSocket.
- **Điểm phù hợp:** 
  - Ghi âm realtime nhận được partial & final transcript mượt mà, đếm thời lượng chính xác.
  - Thao tác sửa text, gộp đoạn, xóa đoạn hoạt động chuẩn xác và tạo phiên bản transcript mới trên backend.
- **Điểm chưa phù hợp:**
  - **BA Mismatch nghiêm trọng:** Thanh phát âm thanh ở footer (`PersistentPlayerBar`) bị khóa ở dạng tĩnh ("Audio chưa sẵn sàng - Chờ nguồn phát từ máy chủ"), không phát được âm thanh thực tế từ media URL.
  - **BA Mismatch:** Thao tác "Tách đoạn" (Split) tự động lấy mốc giữa `(start+end)/2`, không cho phép người dùng nhập/chỉnh mốc thời gian cắt cụ thể.
- **Vấn đề UX:** 
  - Trang bị quá tải thông tin (overloaded layout): vừa chứa Panel Ghi âm, vừa chứa Danh sách Transcript, lại vừa kéo dài cột phải với 5-6 panel phụ (Thông tin, Tiếp tục xử lý, Người nói, Bình luận, Lịch sử phiên bản).
  - Form Edit segment bắt người dùng nhập mốc thời gian bằng `milliseconds` (ví dụ: `15000` ms) thay vì định dạng `mm:ss` thân thiện.
- **Đề xuất:** 
  - Tích hợp HTML5 Audio Player chuẩn khi API trả media URL.
  - Cải tiến ô nhập mốc thời gian Edit/Split thành định dạng `mm:ss`.
  - Tái cấu trúc cột bên phải thành các tab (Tab Thông tin, Tab Người nói, Tab Bình luận, Tab Phiên bản) để giảm chiều cao trang.

### 3.5. Màn hình Tải lên và xử lý file (`UploadPage.tsx`)
- **Mục đích:** Tải tệp audio/video có sẵn lên máy chủ để tạo transcript.
- **Requirement BA:** Khung kéo thả file, thông báo giới hạn dung lượng/thời lượng, hiển thị thanh tiến độ xử lý job, danh sách bản ghi đã xử lý gần đây.
- **Hiện trạng:** Đã triển khai tại `/meetings/:id/upload`.
- **Điểm phù hợp:** Kéo thả/chọn file hoạt động tốt; kiểm tra đuôi file và dung lượng tối đa (MB); thanh tiến độ `jobProgress` cập nhật tự động; khi hoàn tất tự động chuyển về trang transcript `/meetings/:id`.
- **Điểm chưa phù hợp:**
  - Nếu gặp lỗi xử lý file, thông báo lỗi chỉ hiển thị một câu ngắn, thiếu gợi ý cụ thể hoặc nút Thử lại chi tiết theo chuẩn BA E.10.
- **Vấn đề UX:** Nút "Chuyển về" và nút "Tải lên" ở dưới đáy trang đôi khi bị che khuất nếu danh sách file gần đây kéo dài.
- **Đề xuất:** Giữ cố định nhóm nút action bên dưới khu vực upload zone.

### 3.6. Màn hình Quản lý người nói (`SpeakersPage.tsx`)
- **Mục đích:** Danh sách các speaker được phát hiện, gán thông tin hồ sơ (tên, vai trò, tổ chức) và đồng bộ nhãn lên transcript.
- **Requirement BA:** Hiển thị grid các card speaker; hỗ trợ **nghe mẫu giọng (voice sample player)** để đối chiếu; cho phép thêm/sửa speaker.
- **Hiện trạng:** Đã triển khai tại `/meetings/:id/speakers`.
- **Điểm phù hợp:** Hiển thị danh sách speaker cards dạng lưới; phân biệt trạng thái "Đã gán tên" và "Cần xác minh"; form sửa/thêm người nói cập nhật dữ liệu tức thì.
- **Điểm chưa phù hợp:**
  - **BA Mismatch:** **Thiếu hoàn toàn tính năng nghe mẫu giọng phát biểu (Voice Sample Player)** được quy định trong BA Sec C.8 (Mục 8 & Ref 09-speaker.png).
  - Thẻ Speaker Card hiển thị chỉ số "Phân đoạn: Đang đồng bộ" dạng text tĩnh thay vì số lượng segment thực tế.
- **Vấn đề UX:** Người dùng không thể xác định giọng nói của speaker "Chưa xác định" thuộc về ai nếu không có phát nghe thử đoạn giọng ngắn.
- **Đề xuất:** Thêm nút Play Audio Sample trên mỗi thẻ Speaker Card khi API backend trả dữ liệu mẫu giọng.

### 3.7. Màn hình Dịch thuật song ngữ (`TranslationPage.tsx`)
- **Mục đích:** Dịch transcript sang ngôn ngữ đích và hiển thị song song hai ngôn ngữ.
- **Requirement BA:** Chọn ngôn ngữ nguồn/đích; hiển thị 2 cột bản gốc và bản dịch gióng hàng theo từng segment; cho phép xuất nội dung song ngữ.
- **Hiện trạng:** Đã triển khai tại `/meetings/:id/translation`.
- **Điểm phù hợp:** Giao diện 2 cột gióng hàng theo segment rất trực quan; bản dịch được lưu tách biệt không ghi đè transcript gốc.
- **Điểm chưa phù hợp:** 
  - Thanh thông tin ngôn ngữ hiển thị nhãn cứng `BẢN GỐC · VI -> BẢN DỊCH · EN` ngay cả khi ngôn ngữ nguồn của cuộc họp là tiếng Anh (`EN`).
- **Vấn đề UX:** Thiếu nút Cuộn đồng bộ (Synchronized Scrolling) giữa 2 cột khi danh sách segment dài.
- **Đề xuất:** Cập nhật nhãn thanh ngôn ngữ theo `source_language` thực tế của transcript.

### 3.8. Màn hình Tóm tắt AI & Biên bản (`SummaryPage.tsx`)
- **Mục đích:** Tạo tóm tắt cuộc họp theo các mẫu biên bản (General, Briefing, Voting) bằng LLM.
- **Requirement BA:** Hiển thị văn bản tóm tắt phân chia theo mục (Ý chính, Quyết định, Công việc cần làm, Rủi ro); nút Tạo lại; nút Sao chép; panel thông tin bên phải.
- **Hiện trạng:** Đã triển khai tại `/meetings/:id/summary`.
- **Điểm phù hợp:** Đã hỗ trợ chọn mẫu tóm tắt (Mẫu chung, Họp giao ban, Họp biểu quyết); hiển thị tài liệu dạng văn bản có đánh số mục (01, 02...); nút Sao chép hoạt động tốt.
- **Điểm chưa phù hợp:**
  - Khi người dùng bấm "Tạo lại", hệ thống tạo phiên bản tóm tắt mới nhưng UI chỉ hiển thị phiên bản mới nhất (`summaries.data?.[0]`), không có dropdown chọn xem lại các bản tóm tắt cũ.
- **Vấn đề UX:** Các tiêu đề mục tóm tắt tiếng Anh (ví dụ: `key_points`, `action_items`) được format bằng hàm `humanize` thành `Key Points`, `Action Items` thay vì dịch sang tiếng Việt chuẩn nghiệp vụ (`Ý chính`, `Công việc cần làm`).
- **Đề xuất:** Việt hóa bản đồ tên các section tóm tắt (`key_points` -> `Ý chính`, `decisions` -> `Quyết định`, `risks` -> `Rủi ro & Lưu ý`).

### 3.9. Màn hình Xuất dữ liệu & Chia sẻ (`ExportSharePage.tsx`)
- **Mục đích:** Xuất transcript/tóm tắt/bản dịch ra file và cấu hình link chia sẻ cuộc họp.
- **Requirement BA:** Cho phép xuất PDF, DOCX (tối thiểu), mở rộng TXT, SRT, VTT, JSON; checkbox tùy chọn kèm mốc thời gian, người nói; tạo link chia sẻ theo quyền truy cập.
- **Hiện trạng:** Đã triển khai tại `/meetings/:id/export-share`.
- **Điểm phù hợp:** Hỗ trợ đầy đủ 6 định dạng export; các checkbox tùy chọn dữ liệu đính kèm hoạt động chuẩn; luồng tạo link chia sẻ hỗ trợ phân quyền `read`, `comment`, `edit`.
- **Điểm chưa phù hợp:**
  - Giao diện bị dồn hai khối "Xuất tài liệu" và "Chia sẻ" vào chung một màn hình hai cột song song, khiến không gian hiển thị các option bị hẹp.
- **Vấn đề UX:** Nút "Tải file" chỉ xuất hiện sau khi tác vụ Export hoàn tất, nhưng không có chỉ báo visual thông báo file đã được lưu vào thư mục Downloads của trình duyệt.
- **Đề xuất:** Tách thành 2 tab hoặc 2 section xếp chồng có khoảng nghỉ thị giác rõ ràng.

### 3.10. Màn hình Lịch sử & Quản lý dữ liệu (`HistoryPage.tsx`)
- **Mục đích:** Tra cứu, tìm kiếm, lọc và xóa các cuộc họp/bản ghi đã thực hiện.
- **Requirement BA:** Hiển thị danh sách cuộc họp; ô tìm kiếm; lọc theo trạng thái/nguồn; mở lại bản ghi; xóa file audio riêng; xóa cuộc họp có xác nhận.
- **Hiện trạng:** Đã triển khai tại route `/history`.
- **Điểm phù hợp:** 
  - Ô tìm kiếm có xử lý debounce 300ms, lọc server-side mượt mà.
  - Đầy đủ bộ lọc Trạng thái và Nguồn (Realtime/Upload).
  - Modal Quản lý tệp media cho phép xóa audio riêng giữ lại transcript.
  - Modal xác nhận xóa cuộc họp thông báo nguy cơ mất dữ liệu rõ ràng.
- **Điểm chưa phù hợp:**
  - Nhãn trạng thái hiển thị chuỗi enum tiếng Anh (`created`, `recording`, `processing`, `completed`, `failed`).
- **Vấn đề UX:** Các dòng cuộc họp dài thiếu phân trang (pagination) nếu số lượng bản ghi vượt quá 50.
- **Đề xuất:** Việt hóa toàn bộ nhãn Trạng thái (`Đã tạo`, `Đang ghi âm`, `Đang xử lý`, `Hoàn tất`, `Thất bại`) và bổ sung nút Tải thêm / Phân trang.

### 3.11. Màn hình Hồ sơ cá nhân & Cài đặt (`SettingsPage.tsx`)
- **Mục đích:** Xem và cập nhật thông tin tài khoản, cài đặt tùy chọn nghiệp vụ.
- **Requirement BA:** Cập nhật thông tin cá nhân; đổi mật khẩu/đăng xuất; cấu hình ngôn ngữ mặc định & diarization; xem dung lượng lưu trữ retention.
- **Hiện trạng:** Đã triển khai tại route `/settings`.
- **Điểm phù hợp:** Xem và cập nhật Họ và tên; hiển thị trạng thái xác minh email; nút Đăng xuất an toàn.
- **Điểm chưa phù hợp:**
  - **BA Mismatch:** Nút "Đổi mật khẩu" không mở form đổi mật khẩu tại chỗ mà điều hướng ra ngoài màn hình Đăng nhập.
  - Dòng ghi chú cuối trang thừa nhận: *"Ngôn ngữ nhận diện mặc định, diarization, số điện thoại và dung lượng lưu trữ chưa có contract API"*.
- **Vấn đề UX:** Trang khá trống trải do thiếu các phần thiết lập cấu hình thực tế.
- **Đề xuất:** Thêm form đổi mật khẩu trực tiếp (Nhập mật khẩu hiện tại, Mật khẩu mới, Xác nhận mật khẩu).

### 3.12. Màn hình Xem link chia sẻ công khai (`SharePage.tsx`)
- **Mục đích:** Cho phép người nhận link truy cập xem nội dung cuộc họp theo quyền được cấp.
- **Requirement BA:** Người dùng truy cập qua link chia sẻ được xem transcript/summary/diễn biến cuộc họp tương ứng với quyền.
- **Hiện trạng:** Đã triển khai tại route `/share/:token`.
- **Điểm phù hợp:** Giải mã token hợp lệ, hiển thị tiêu đề, mô tả, trạng thái và quyền truy cập của link.
- **Điểm chưa phù hợp:**
  - **BA Mismatch:** Trang hiển thị dòng cảnh báo: *"API công khai hiện chỉ cung cấp metadata cuộc họp; transcript và kết quả cần endpoint chia sẻ riêng..."*. Người nhận link **không xem được nội dung transcript thực tế**.
- **Vấn đề UX:** Người nhận link chia sẻ bị rơi vào "dead-end" vì không xem được nội dung bóc băng.
- **Đề xuất:** Cần ghi nhận đây là mâu thuẫn nghiệp vụ giữa Frontend và Backend API contract (cần bổ sung endpoint public transcript access).

---

## 4. Audit User Flow

### Flow 1: Đăng nhập → Danh sách cuộc họp → Tạo phiên họp → Ghi âm realtime → Transcript
- **Mô tả luồng:** User đăng nhập -> Vào `/meetings` -> Nhập thông tin tạo cuộc họp -> Bấm "◉ Đến màn ghi âm" -> Chuyển đến `/meetings/:id` -> Bắt đầu ghi âm realtime -> Nhận transcript -> Kết thúc ghi âm.
- **Đánh giá:** Luồng chạy thông suốt kỹ thuật.
- **Vấn đề phát hiện:** 
  1. *Điều hướng chồng chéo:* Nút "Tạo phiên họp mới" ở Sidebar lại trỏ về `/meetings` (nơi đang chứa cả form tạo lẫn danh sách cuộc họp cũ).
  2. *Quá tải giao diện:* Màn ghi âm realtime bị ghép chung vào trang xem transcript `/meetings/:id`, làm xuất hiện đồng thời cả Recording Panel, Editor, Speaker Panel, Comments Panel, Version Panel làm màn hình rất rối.

### Flow 2: Danh sách cuộc họp → Upload file → Processing → Transcript
- **Mô tả luồng:** User tại `/meetings` -> Nhập thông tin -> Bấm "⇧ Tạo để tải tệp" -> Chuyển đến `/meetings/:id/upload` -> Kéo thả file -> Bấm "Tải lên và xử lý" -> Theo dõi thanh tiến độ Job -> Tự động chuyển về `/meetings/:id` khi hoàn tất.
- **Đánh giá:** Luồng xử lý mượt mà, tự động điều hướng tốt.
- **Vấn đề phát hiện:** 
  1. Nút "Tải lên bản ghi" trên Sidebar khi bấm ở ngoài cuộc họp sẽ mở trang upload của cuộc họp gần nhất thay vì khởi tạo một luồng upload cuộc họp mới.

### Flow 3: Transcript → Chỉnh sửa → Quản lý speaker
- **Mô tả luồng:** User xem transcript tại `/meetings/:id` -> Bấm "Chỉnh sửa" trên segment -> Sửa văn bản/thời gian/speaker -> Bấm "Lưu phiên bản mới". Hoặc bấm "Quản lý người nói" -> Sang `/meetings/:id/speakers` -> Cập nhật tên speaker -> Quay lại Transcript.
- **Đánh giá:** Dữ liệu đồng bộ tức thì giữa các màn hình.
- **Vấn đề phát hiện:** 
  1. *Tách đoạn (Split):* Tự động chia đôi mốc thời gian `(start+end)/2`, không cho user chọn vị trí cắt chính xác.
  2. *Thiếu nghe thử giọng:* Màn hình Quản lý người nói không có nút phát nghe mẫu giọng (Voice Sample) để xác minh speaker.

### Flow 4: Transcript → Dịch thuật
- **Mô tả luồng:** User tại `/meetings/:id` -> Bấm "Dịch" -> Chuyển đến `/meetings/:id/translation` -> Chọn ngôn ngữ đích (EN) -> Bấm "Tạo bản dịch" -> Hiển thị 2 cột song ngữ.
- **Đánh giá:** Dữ liệu bản dịch lưu riêng biệt, không đè bản gốc.
- **Vấn đề phát hiện:** 
  1. Nhãn thanh ngôn ngữ cố định `VI -> EN` chưa linh hoạt theo ngôn ngữ gốc của cuộc họp.

### Flow 5: Transcript → Tóm tắt AI / Biên bản
- **Mô tả luồng:** User tại `/meetings/:id` -> Bấm "Tóm tắt" -> Chuyển đến `/meetings/:id/summary` -> Chọn Mẫu (General/Briefing/Voting) -> Bấm "Tạo tóm tắt" -> Render văn bản có đánh số mục -> Bấm "Sao chép".
- **Đánh giá:** Tạo tóm tắt đúng mẫu, hiển thị bố cục văn bản đẹp.
- **Vấn đề phát hiện:** 
  1. Tên các section tóm tắt bị hiển thị dạng tiếng Anh dạng `Key Points`, `Action Items`.
  2. Khi bấm "Tạo lại", hệ thống không cho chọn xem lại bản tóm tắt ở các lần tạo trước.

### Flow 6: Transcript → Export / Share
- **Mô tả luồng:** User tại `/meetings/:id` -> Bấm "Xuất" -> Chuyển đến `/meetings/:id/export-share` -> Chọn định dạng (PDF/DOCX/TXT/SRT/VTT/JSON) -> Chọn option -> Bấm "Tạo file" -> Bấm "Tải file". Tạo link chia sẻ ở khối bên phải.
- **Đánh giá:** Hỗ trợ đầy đủ định dạng và phân quyền link.
- **Vấn đề phát hiện:** 
  1. Trang công khai `/share/:token` không hiển thị transcript cho người nhận link.

### Flow 7: Lịch sử → Mở meeting cũ → Quản lý / xóa dữ liệu
- **Mô tả luồng:** User truy cập `/history` -> Tìm kiếm/lọc -> Bấm "Mở" để xem transcript, bấm "Tệp" để xóa audio riêng, hoặc bấm "Xóa" để xóa toàn bộ meeting.
- **Đánh giá:** Quản lý dữ liệu an toàn, có modal xác nhận đầy đủ.
- **Vấn đề phát hiện:** 
  1. Chưa có phân trang cho danh sách lịch sử dài.

---

## 5. Các state còn thiếu

Các trạng thái giao diện (UI states) sau đây chưa được triển khai hoặc thiếu trong hệ thống:

1. **Audio Playback Ready / Media Playing State:** Thiếu trạng thái thanh phát audio hoạt động thực tế (Phát, Tạm dừng, Tua timeline, Sync highlight chữ theo tiếng).
2. **Split Segment Time Picker State:** Thiếu trạng thái/giao diện cho phép chọn chính xác mốc thời gian tách đoạn.
3. **Voice Sample Playing State:** Thiếu trạng thái đang nghe mẫu giọng nói trong màn Quản lý người nói.
4. **Confirmation Dialog State (Merge & Split):** Thiếu modal xác nhận trước khi thực hiện Tách hoặc Gộp đoạn.
5. **Public Transcript Viewing State:** Thiếu trạng thái hiển thị nội dung bóc băng cho người xem qua link chia sẻ công khai (`/share/:token`).
6. **404 Not Found Page State:** Thiếu trang 404 riêng khi truy cập vào một URL không tồn tại (hiện tự động fallback về `/meetings`).

---

## 6. Vấn đề UI/UX xuyên suốt hệ thống

Đánh giá chi tiết các dấu hiệu giao diện dạng **"AI-generated / vibe-coded"**:

- **Quá nhiều Card & Border mỏng:** Gần như mọi phần tử trên trang đều được bọc trong một khối Card với viền mỏng (`1px solid #dfe5ee`). Điều này khiến giao diện bị dẹt (flat), thiếu độ sâu thị giác và tạo cảm giác chật chội.
- **Bố cục 2 cột gượng ép:** Màn hình Create Meeting, Summary, Export/Share đều ép buộc chia 2 cột (cột chính bên trái + panel hướng dẫn/context bên phải) làm thu hẹp không gian thao tác chính.
- **Nhãn Trạng thái (Status Badge) không Việt hóa:** Tất cả các badge trạng thái cuộc họp đều hiển thị chữ tiếng Anh viết thường/nguyên bản (`created`, `recording`, `processing`, `completed`, `failed`), không phù hợp với ứng dụng tiếng Việt.
- **Chi tiết trang trí không chức năng (Dummy UI Elements):** Topbar có hiển thị chấm xanh "Sẵn sàng kết nối" và 2 icon Setting/Profile nhưng không thể click hay tương tác.
- **Visual Hierarchy chưa rõ ràng:** Các nút bấm hành động phụ (Secondary buttons) có màu nền trắng viền mỏng tiệm màu với viền Card, khiến người dùng khó nhận biết vùng bấm.

---

## 7. Danh sách issue theo mức độ ưu tiên

### P0 — Chặn user flow chính / Sai lệch cốt lõi
- **Issue P0.1 (Technical/UI Issue):** Thanh phát âm thanh (`PersistentPlayerBar`) ở footer bị vô hiệu hóa hoàn toàn ("Audio chưa sẵn sàng - Chờ nguồn phát từ máy chủ"). Người dùng không thể vừa nghe lại băng vừa kiểm duyệt/sửa transcript — đây là tính năng cốt lõi của hệ thống Bóc Băng.

### P1 — Không đáp ứng hoặc mâu thuẫn requirement BA
- **Issue P1.1 (BA Mismatch):** Thiếu các Route/URL chuẩn theo BA Spec (`/register`, `/forgot-password`, `/meetings/create`). Các luồng này hiện bị gộp chung trong React state của `AuthPage` và `MeetingsPage`.
- **Issue P1.2 (BA Mismatch):** Nút "Tải lên bản ghi" ở Sidebar hoạt động sai ngữ cảnh: trỏ về trang upload của cuộc họp cũ thay vì mở luồng tạo cuộc họp mới bằng file upload.
- **Issue P1.3 (BA Mismatch):** Màn hình Quản lý người nói (`/meetings/:id/speakers`) thiếu tính năng "Nghe mẫu giọng phát biểu" (Voice Sample Player) được yêu cầu tại BA Sec C.8.
- **Issue P1.4 (BA Mismatch):** Thao tác Tách đoạn (Split Segment) tự động cắt ở `(start+end)/2`, không cho phép người dùng nhập/chọn mốc thời gian tách chính xác theo BA Sec C.7.
- **Issue P1.5 (BA Mismatch):** Trang xem link chia sẻ công khai (`/share/:token`) chỉ hiển thị thông tin metadata, không hiển thị nội dung transcript cho người được chia sẻ.
- **Issue P1.6 (BA Mismatch):** Tất cả Status badge trên toàn hệ thống hiển thị chuỗi enum tiếng Anh (`recording`, `processing`, `completed`, `failed`) thay vì tiếng Việt chuẩn nghiệp vụ.

### P2 — Vấn đề UX đáng kể
- **Issue P2.1 (UX Issue):** Màn hình Chi tiết phiên họp (`/meetings/:id`) bị ôm đồm quá nhiều box panel phụ (Recording, Transcript, Meeting Context, Capability, Speakers, Comments, Versions) làm trang kéo dài vô tận và phân tán sự chú ý.
- **Issue P2.2 (UX Issue):** Thao tác Gộp đoạn (Merge) và Tách đoạn (Split) thực thi ngay lập tức mà không có Confirmation Dialog để tránh bấm nhầm.
- **Issue P2.3 (UX Issue):** Thanh Persistent Player Bar luôn hiển thị cố định ở chân trang kể cả khi không có file audio để phát, chiếm diện tích màn hình.
- **Issue P2.4 (UX Issue):** Mode chỉnh sửa segment bắt người dùng nhập mốc thời gian bằng `milliseconds` (ví dụ: `12000`) thay vì định dạng phút:giây (`mm:ss`) thân thiện.
- **Issue P2.5 (UX Issue):** Tên các mục section trong Tóm tắt AI bị hiển thị dạng `Key Points`, `Action Items` thay vì Việt hóa (`Ý chính`, `Công việc cần làm`).

### P3 — Polish / Consistency / Visual Refinement
- **Issue P3.1 (Visual Issue):** Lạm dụng quá nhiều khung viền Card/Panel mỏng làm giao diện bị gián đoạn và phẳng lì ("AI-generated vibe").
- **Issue P3.2 (Visual Issue):** Ô tìm kiếm tại Sidebar là UI tĩnh, không thực hiện tìm kiếm/lọc.
- **Issue P3.3 (Visual Issue):** Topbar chứa các icon Setting/Profile và chỉ báo kết nối trang trí không bấm được.

---

## 8. Đề xuất thứ tự xử lý

*(Lưu ý: Đây là đề xuất văn bản về định hướng xử lý. Chưa có bất kỳ thay đổi nào được thực hiện đối với source code).*

1. **Giai đoạn 1: Xử lý các vấn đề P0 & P1 (Logic nghiệp vụ, Route & BA Mismatch)**
   - Tách các Route chuẩn: `/register`, `/forgot-password`, `/meetings/create`.
   - Sửa nút "Tải lên bản ghi" ở Sidebar để mở đúng luồng tạo cuộc họp mới từ file upload.
   - Việt hóa toàn bộ các nhãn Trạng thái (Status badge: `Đã tạo`, `Đang ghi âm`, `Đang xử lý`, `Hoàn tất`, `Thất bại`).
   - Tích hợp HTML5 Audio Player thực tế khi backend trả media URL, cho phép nghe lại audio và đồng bộ vị trí timeline với transcript.
   - Bổ sung nút nghe mẫu giọng (Voice Sample Player) tại màn hình Quản lý người nói.
   - Cải tiến tính năng Tách đoạn (Split): cho phép nhập/chọn mốc thời gian cắt cụ thể.

2. **Giai đoạn 2: Xử lý các vấn đề P2 (Tối ưu UX & Control Flow)**
   - Tái cấu trúc layout màn hình Chi tiết phiên họp (`/meetings/:id`): thu gọn các panel phụ (Bình luận, Lịch sử phiên bản, Người nói) vào dạng Tabs/Drawer bên phải để tập trung tối đa không gian cho khu vực Transcript.
   - Bổ sung Modal xác nhận (Confirmation Dialog) cho thao tác Tách đoạn và Gộp đoạn.
   - Chuyển ô nhập mốc thời gian trong mode Edit segment từ `milliseconds` sang định dạng `mm:ss`.
   - Việt hóa các tiêu đề mục tóm tắt AI (`Key Points` -> `Ý chính`, `Action Items` -> `Công việc cần làm`).

3. **Giai đoạn 3: Xử lý các vấn đề P3 (Polish UI & Visual Refinement)**
   - Tinh chỉnh CSS design tokens: giảm bớt border dư thừa, tăng tương phản nhẹ giữa màu nền ứng dụng (`#f4f7fb`) và thẻ nội dung (`#ffffff`).
   - Loại bỏ hoặc kích hoạt tính năng thực tế cho các icon/chỉ báo tĩnh trên Topbar.
   - Kết nối ô tìm kiếm ở Sidebar với bộ lọc cuộc họp thực tế.

---

## 9. Các file/component có khả năng liên quan

*(Danh sách các file/component có khả năng cần sửa đổi trong tương lai. Chưa có bất kỳ chỉnh sửa nào được thực hiện trên các file này).*

1. `frontend/src/app/App.tsx`
   - *Lý do liên quan:* Cần bổ sung các route mới (`/register`, `/forgot-password`, `/meetings/create`).
2. `frontend/src/components/AppShell.tsx`
   - *Lý do liên quan:* Cần sửa nút "Tải lên bản ghi" ở Sidebar, thay đổi logic `PersistentPlayerBar` khi có audioURL và kích hoạt thanh tìm kiếm.
3. `frontend/src/components/ui.tsx`
   - *Lý do liên quan:* Cần cập nhật Việt hóa nhãn hiển thị của component `Status` badge.
4. `frontend/src/pages/AuthPage.tsx`
   - *Lý do liên quan:* Cần tách nhỏ các form Đăng ký/Quên mật khẩu và bổ sung các trường thông tin còn thiếu.
5. `frontend/src/pages/MeetingsPage.tsx`
   - *Lý do liên quan:* Cần tách form Tạo cuộc họp thành màn hình riêng `/meetings/create`.
6. `frontend/src/pages/MeetingPage.tsx`
   - *Lý do liên quan:* Cần tích hợp HTML5 Audio Player, cải tiến tính năng Tách đoạn (Split), thêm modal xác nhận Tách/Gộp và chuyển mốc thời gian từ ms sang `mm:ss`.
7. `frontend/src/pages/SpeakersPage.tsx`
   - *Lý do liên quan:* Cần bổ sung nút nghe mẫu giọng (Voice Sample Player) cho thẻ Speaker Card.
8. `frontend/src/pages/SummaryPage.tsx`
   - *Lý do liên quan:* Cần Việt hóa các key section tóm tắt và bổ sung chọn xem phiên bản tóm tắt cũ.
9. `frontend/src/pages/TranslationPage.tsx`
   - *Lý do liên quan:* Cần cập nhật nhãn ngôn ngữ linh hoạt theo `source_language`.
10. `frontend/src/pages/SettingsPage.tsx`
    - *Lý do liên quan:* Cần bổ sung form đổi mật khẩu trực tiếp tại chỗ.
11. `frontend/src/pages/SharePage.tsx`
    - *Lý do liên quan:* Cần cập nhật giao diện hiển thị transcript cho trang xem link chia sẻ công khai khi backend nâng cấp contract.

---

Audit hoàn tất. Chưa có thay đổi nào được thực hiện đối với source code.
