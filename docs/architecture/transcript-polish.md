# Làm mịn transcript và duyệt thủ công

Khi người dùng xác nhận kết thúc, upstream STT đóng/flush trước, mọi final và
speaker correction được lưu, rồi meeting hoàn tất và job `transcript_polish`
được commit cùng transaction. Frontend không gọi HTTP complete song song với
`recording.stop`. Disconnect/chuyển công cụ chỉ pause, không tạo job làm mịn.
Complete HTTP dùng cho cuộc họp không còn socket. Complete lặp lại là no-op;
AI chưa cấu hình hoặc không có final text không ngăn kết thúc cuộc họp.

## Input và provider

- Chụp revision hiện tại qua `TranscriptVersionReader`, gồm cả edit events,
  không chỉ snapshot STT. Lưu text/ID/người nói/timing nguồn trong payload job.
- Dùng LLM Gemini/Groq và fallback đang cấu hình, không cần key hoặc model mới.
  `LLMProvider.polish_transcript(texts, context)` trả tuple text cùng thứ tự/số
  lượng; không trả timing, speaker ID, hoặc schema tóm tắt năm mục.
- Prompt yêu cầu sửa bảo thủ lỗi chép lời/dấu câu, giữ ngôn ngữ, tên/số/phủ định/
  độ chắc chắn; không tóm tắt hay sáng tác. Transcript là dữ liệu không đáng tin,
  không phải chỉ dẫn cho AI. Semantic correctness vẫn cần người dùng duyệt.
- Mỗi request tối đa 40 đoạn hoặc khoảng 12.000 ký tự (đoạn đơn dài hơn được
  giữ nguyên). Meeting dài xử lý tuần tự, mỗi nhóm đọc thêm tối đa 3.000 ký tự
  trước/sau làm ngữ cảnh. Không hứa toàn bộ meeting dài nằm trong một request.
- Validate output count/nonempty/length trước khi lưu. Không publish kết quả
  nửa chừng. Provider lỗi retry theo job lifecycle; queued job sống qua lỗi Redis
  và được reconciler giao lại. Không có execution lease recovery mới cho worker
  bị kill giữa `processing`; đây vẫn là giới hạn queue hiện tại.

## Proposal, nháp và chốt

Không cần migration mới: `jobs.payload` giữ `source_version_id`, `actor_id`,
`originals`, `prompt_version`, `generated`, `generated_at`, `provider_adapter`,
`draft`, `revision`, và khi duyệt: `accepted_version_id/by/at`.
`generated` không bị ghi đè bởi sửa nháp; source snapshot không bị sửa.
Provider adapter ghi tên lớp, không khẳng định provider thực tế khi fallback.

Sau khi hoàn tất, nút Làm mịn trên toolbar tự đọc/poll job và hiển thị trạng
thái dù hộp đang đóng. Bấm mới mở native dialog ở cùng trang, không có panel
duyệt phía trên transcript và không tự mở. Có `Đối chiếu bản gốc`, `Sửa transcript`, `Lưu bản nháp`,
`Chốt transcript`; nháp được lưu backend, đọc lại sau reload. Nếu AI lỗi có
thể thử lại hoặc dùng editor transcript hiện tại. Cuộc họp cũ/upload hoàn tất
cũng có nút yêu cầu làm mịn thủ công, không tự chạy hồi tố tất cả meeting.

Controller frontend dùng chung proposal/draft/revision giữa toolbar và hộp;
không có hai pollers độc lập ghi đè nháp. Poll job pending mỗi 2 giây, lỗi đọc
thử lại sau 5 giây; metadata meeting chưa hoàn tất kiểm tra mỗi 10 giây và
sự kiện scoped/focus làm mới ngay. Job terminal không poll liên tục. GET
transcript limit=1 kiểm tra có nội dung/current revision; chỉ lỗi 404 mới coi
là thiếu, không biến lỗi mạng thành transcript trống. Đọc trạng thái không gọi
POST generate hoặc accept. Capability/ACL quyết định quyền tạo, không cản đọc
kết quả cũ khi provider tắt. Chưa completed hoặc không có transcript thì khóa
nút kèm lý do; query/provider errors, stale source và chờ duyệt có trạng thái riêng.

Mở hộp không thay route/unmount workspace. Nháp chưa lưu không bị poll/focus/
lỗi ghi đè; đóng/Escape hỏi bỏ nháp ngay trong hộp, không dùng blocking confirm.
Giữ expected draft revision và source checks của backend. Accept thành công
phát sự kiện meetingId/reloadCurrent để Bản ghi đọc current transcript mới;
notification metadata thông thường không tạo vòng lặp tự reload. Toolbar bảy
công cụ dùng icon, dấu trạng thái và tooltip hover/focus đầy đủ lý do/trạng thái;
nút khóa vẫn truy cập tooltip bằng bàn phím. Toolbar tự xuống hàng cùng điều
khiển ghi âm, đo chiều cao thật để chừa khoảng transcript trên màn hình hẹp.
Không đổi prompt/provider/API/DB.

Read ACL để xem; edit ACL cho tạo/sửa/chốt. Review gửi toàn bộ logical IDs/text
và expected draft revision. Không nhận timing/speaker từ client. Khóa segments
→ meeting → job, đối chiếu source pointer và toàn bộ snapshot trước khi ghi;
source đổi hoặc reviewer khác lưu trước trả `409 VERSION_CONFLICT`.

Chốt tạo đúng một `user_edit` revision/checkpoint và các edit events gắn proposal,
cập nhật projection/current pointer và trạng thái proposal trong một commit.
Giữ nguyên original_stt_text, timing, speaker, logical IDs. Bản gốc đọc/rollback
qua lịch sử; summary/translation/export mới dùng revision đã chốt, output cũ
không tự tạo lại. Chốt lại proposal đã chốt bị từ chối, không tạo revision lặp.

## Acceptance sau rebuild

1. Ghi âm và kết thúc khi đang nói: đoạn final lúc close có trong bản nháp.
2. Chờ AI, rời trang/reload, quay lại vẫn thấy đúng trạng thái/draft.
3. So sánh gốc, sửa và lưu nháp; transcript hiện tại chưa đổi.
4. Chốt; reload và kiểm tra người nói/timing, lịch sử/rollback và export mới.
5. Lỗi provider/429/Redis, quyền read/comment, hai editor, source bị sửa,
   transcript trống và meeting upload cũ.
6. Theo dõi badge khi hộp đóng, mở/đóng/Escape, nháp khi focus/reload lỗi;
   trạng thái accepted phải theo pointer server, Bản ghi cập nhật ngay sau chốt.
   Kiểm tra toolbar bảy mục và khoảng tránh che transcript trên mobile.

Automated tests dùng provider mô phỏng; chất lượng làm mịn và browser/microphone
vẫn cần đo với Gemini/Groq/Speechmatics thật. Không dùng build thay acceptance.
