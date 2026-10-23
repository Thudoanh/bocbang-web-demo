# Các phiên có tên trong một cuộc họp

Một meeting vẫn là một tài nguyên ACL/lịch sử duy nhất. Bên trong có các
`meeting_sections` theo thứ tự, tên, `start_ms`, `end_ms` nullable và `is_started`.
Timeline dùng thời lượng âm thanh thực đã thu, không tính thời gian nghỉ.

## Ghi âm và tách phiên

- Meeting mới có `Phiên 1`; có thể đổi tên trước/sau khi ghi.
- Nút Tạm dừng mở native dialog hai lựa chọn, chưa gọi pause/split khi mở:
  Tạo phiên mới (`new_section:true`) hoặc Chỉ tạm dừng (`new_section:false`).
  Ghi âm tiếp tục trong lúc chờ chọn (hộp ghi rõ). Đóng/X/Escape chọn nhánh
  thường; mặc định focus Chỉ tạm dừng, chống chọn lặp, focus trap/return/scroll.
- Khi chọn Tạo phiên mới, client gửi `recording.pause` với `new_section:true`.
  Client dừng/flush
  microphone rồi chờ xác nhận; server đóng upstream, lưu mọi final/correction,
  flush audio rồi chốt boundary = max PCM clock/final end. Đóng upstream là cần
  thiết để một utterance không tiếp tục kéo qua ranh giới phiên.
- Phiên cũ có end; phiên tiếp theo bắt đầu ở boundary nhưng `is_started=false`.
  Trả `meeting.sections {paused:true,sections:[...]}` sau commit. Client nhắc
  mở Phiên họp để đặt tên; không tự bật hộp quản lý hay thu âm lại. Pause lặp
  khi đã dừng không sinh thêm phiên.
- Tiếp tục mở upstream mới với known speakers mới nhất và cùng offset audio,
  đánh dấu phiên đã bắt đầu rồi trả `recording.resumed`; chỉ sau ACK client
  mới tiếp tục microphone. Generic speaker IDs có thể đổi qua upstream mới;
  không tự đoán chúng là cùng người, vẫn dùng profile đã xác nhận khi có.
- Chuyển công cụ/navigation dùng pause không có `new_section`, giữ phiên.
  Đây cũng là compatibility path cho client cũ. Disconnect không tách phiên.
- Chỉ tạm dừng cũng giữ phiên/end_ms/tên/ID và upstream hiện tại. UI mới gửi
  `acknowledge:true`; server flush audio/pause provider rồi trả `recording.paused`.
  UI chờ ACK mới hiện paused. Resume gửi `acknowledge:true`, server resume thành
  công mới trả `recording.resumed {new_section:false,...flags}`; sau đó client
  mới thu lại trong phiên cũ. Nhánh mới trả `new_section:true`; reconnect dựa
  is_started của phiên thật, không coi mọi reconnect là bắt đầu một phiên mới.
  Trường acknowledge mặc định false, lệnh/luồng legacy không thêm ACK thường.
- Socket tự reconnect khi đang dừng gửi query `start_paused=1`, không tự thu âm
  hoặc đánh dấu pending session đã bắt đầu. Sau reload chỉ ghi lại khi người
  dùng bấm Tiếp tục ghi âm. Pause/resume timeout báo cần kiểm tra/kết nối lại.
- Kết thúc đóng phiên hiện tại và vẫn chạy luồng làm mịn transcript đã có.
  Nếu chưa resume, phiên cuối rỗng được giữ với trạng thái chưa thu; không fake
  nội dung. Không cho mở lại stream vào meeting đã completed.

## Quản lý phiên trên frontend

Điều khiển start/pause/resume/end và đồng hồ/trạng thái chuyển xuống toolbar
đáy dạng biểu tượng, không còn khung Ghi âm phía trên transcript. RecordingPanel
vẫn sở hữu toàn bộ lifecycle/socket/confirmation ở trang Bản ghi; chỉ trình bày
được portal vào host AppShell ổn định. Hover/focus/resize/mở hộp không remount
bộ ghi. Hộp chọn pause không hoàn tất meeting hoặc gọi AI; resume ACK và xác
nhận trước explicit end vẫn được giữ. Không thêm migration hoặc đổi dữ liệu cũ.

Nút Phiên họp ở thanh công cụ dưới mở native dialog do AppShell sở hữu, bên
cạnh nội dung hiện tại, không chuyển route hoặc unmount RecordingPanel.
Không có lệnh pause/resume/stop trong thao tác mở/đổi tên/đóng hộp; tên có thể
sửa khi đang thu, và các phiên cũ/upload cũng mở được. Dữ liệu chỉ tải khi mở;
sự kiện `bocbang:meeting-sections-changed` mang meetingId cập nhật hộp đúng
meeting sau pause/resume/end/rename. Không còn khung phiên trên Bản ghi.

Read/comment chỉ xem; edit/owner thêm, xóa, đổi tên và chỉnh mốc trong dialog.
Mỗi lần sửa mở một form tên/bắt đầu/kết thúc; giữ chính xác phần mili giây,
nhận mm:ss hoặc hh:mm:ss và phần .123. Mốc đầu 00:00 và cuối meeting được giữ.
Thêm một mốc nằm trong thời lượng đã ghi để tách phiên; sửa ranh giới cập nhật
phiên kề, không để khoảng trống/chồng lấn. Xóa có xác nhận, gộp khoảng vào phiên
trước (xóa đầu thì gộp vào phiên sau); giữ tối thiểu một phiên bao phủ meeting.
Không có thao tác nào sửa/cắt/xóa transcript, audio, người nói hay phiên bản cũ.
Segment vượt ranh giới không bị cắt: vẫn thuộc nhóm theo start_ms.

Nháp giữ khi refresh/lỗi, chống gửi trùng và cảnh báo khi đóng. Revision là hash
của ID/thứ tự/tên/mốc/is_started của cả danh sách, không gồm thời lượng tăng
liên tục của stream. Form giữ revision lúc mở; thay đổi từ cửa sổ khác hoặc
pause/resume khiến revision cũ bị 409, không tự replay bản nháp vào layout mới.
Meeting row lock tuần tự hóa với begin/split/finish và enqueue summary. Không
migration mới; bộ ghi/socket/controller không remount hoặc bị điều khiển bởi hộp.

## API / ACL

`GET /meetings/{id}/sections` cần read, trả ordered list
`{id,meeting_id,sequence,title,start_ms,end_ms,is_started,revision}`.
`POST /meetings/{id}/sections` nhận `{title,start_ms,expected_revision}`, trả list
201. Khi dữ liệu cũ chưa có phiên, khởi tạo tại 0 trước; sau đó thêm mốc nội bộ.
`PATCH /meetings/{id}/sections/{section_id}` nhận title/start_ms/end_ms;
boundary edits bắt buộc expected_revision. Title trim 1–255 ký tự, title-only
legacy vẫn được hỗ trợ. `DELETE .../{section_id}?expected_revision=...` trả
list mới 200. Tất cả mutations cần edit, ID đúng meeting, dùng row lock;
409 SECTION_CONFLICT nếu layout đã đổi, 422 nếu mốc không hợp lệ. Mọi thao tác
vẫn dùng được sau hoàn tất; không mở lại cuộc họp. Tối đa 1000 phiên khi thêm.

## Tóm tắt

Summary request có `scope: sessions | meeting`. UI mặc định `sessions`, còn API
vắng field mặc định `meeting` để giữ client/job cũ. Cả mẫu có sẵn và custom
prompt/VI–EN áp dụng được. Không tự gọi LLM khi pause.

UI có checkbox từng phiên, Chọn tất cả/Bỏ chọn tất cả, đếm số đã chọn; phải chọn
ít nhất một phiên. Gửi section_ids và sections_revision; bỏ field IDs ở API cũ
vẫn lấy tất cả, explicit []/trùng/khác meeting/đã xóa bị từ chối. Phân nhóm theo
TOÀN BỘ boundary trước rồi mới lọc phiên được chọn, để không lấy nhầm lời thoại
của phiên bị bỏ chọn. Không lưu nguyên transcript toàn meeting vào job sessions.
Phiên implicit legacy không có ID vẫn hỗ trợ một nhóm qua API cũ/UI fallback.

Request chụp text hiện tại qua `TranscriptVersionReader` (cả manual edits và
bản làm mịn đã chốt), tên/range của từng phiên và lưu trong job payload.
Không dùng một STT version còn có thể append làm nguồn duy nhất: text input
được snapshot riêng để không đổi trong lúc queued/processing.

Mỗi segment thuộc phiên có start boundary cuối cùng <= start_ms của segment.
Các phiên là khoảng liền nhau; không duplicate text ở boundary. Sửa timing
có thể làm segment đổi nhóm; không cho merge hai segment ở hai phiên khác
nhau. Làm mịn chỉ sửa chữ nên giữ nguyên nhóm. Old data chưa có section dùng
một nhóm `Phiên 1`, không tự đoán lịch sử ranh giới đã mất.

Worker gọi LLM riêng cho từng nhóm, không đưa transcript phiên khác vào prompt.
Phiên rỗng không gọi AI, content=null. Job progress cập nhật thật qua từng nhóm,
chỉ publish summary khi tất cả nhóm thành công; lỗi giữa chừng không lưu output
nửa vời. Nội dung version có dạng:

```json
{"sessions":[{"id":"uuid","sequence":1,"title":"Kế hoạch","start_ms":0,"end_ms":120000,"meeting_id":"uuid","is_started":true,"content":{"overview":"...","key_points":[],"action_items":[],"decisions":[],"risks_notes":[]}}]}
```

Custom content của từng phiên vẫn là `{content:string}`. Không đổi LLM adapter
hay credentials. Summary identity gồm input revision + scope + mode/template/
language. UI có từng card tên phiên, copy tất cả, Sửa phiên này; lưu tạo version
mới và giữ metadata/các phiên còn lại. Optional `expected_version_no` chặn
ghi đè người khác, UI luôn gửi field này. Tên/range trong output là snapshot
lúc enqueue, không âm thầm đổi bản tóm tắt cũ sau rename. Summary/export cũ vẫn
giữ provenance của chúng; export JSON giữ nguyên cấu trúc sessions.

Chọn tập phiên khác sẽ tạo version mới theo identity hiện tại, giống tạo lại
với prompt khác; không ghi đè version cũ. UI ghi rõ kết quả lần tạo gần nhất,
hiển thị đúng các card trong snapshot, không lọc/mạo nhận theo checkbox hiện tại.

## Migration và kiểm thử

`0017` thêm table/cascade/index/interval+sequence constraints, backfill mọi
meeting cũ thành `Phiên 1` và thêm summaries.scope=`meeting`; summary/transcript
cũ không bị viết lại. Upload batch mới cũng cập nhật một phiên đầy đủ.
Downgrade có nhiều summary scope trùng identity cũ sẽ từ chối và yêu cầu lưu
trữ/xử lý rõ ràng, không tự xóa output để ép unique constraint.

Tests mô phỏng kiểm tra close-final → boundary → pending → resume, tên/ACL,
context không trộn phiên, snapshots, empty/failure, version conflicts, làm mịn
rồi tóm tắt, merge guard và upgrade/backfill/downgrade SQLite. Cần rebuild và
browser/microphone acceptance với provider thật, gồm mất mạng và nhiều phiên.
