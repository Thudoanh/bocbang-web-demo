# Băng ghi âm toàn cuộc họp và nghe lại

## Lưu băng sau kết thúc

`recording.stop` flush capture/STT/audio chunks trước khi gọi completion chung.
Completion tạo durable job `recording_assembly` cùng transaction với trạng thái
completed, độc lập job làm mịn. Chỉ tạo khi realtime có chunk; gọi complete lặp
không tạo lại. Publish lỗi không đảo completion, reconciler phát lại queued job.
Worker dispatch nhánh này trước khi khởi tạo STT/translation/LLM providers.

Không có migration mới: dùng `jobs` và `media_files` hiện tại (head 0017, chunks
từ 0016). Payload chụp ID/key/recording ID/start/end của từng chunk. Worker đọc
từng WAV PCM16 mono 16kHz, kiểm tra format/byte count, ghép vào tệp tạm theo thứ
tự timeline rồi lưu qua storage local/S3. Không giữ toàn bộ meeting trong RAM,
không gọi AI/STT/FFmpeg, không thay transcript/speaker/timestamp/version.

Chỉ publish MediaFile completed và Job completed cùng transaction, sau khi kiểm
tra lại meeting/source. Object key riêng từng job, cleanup best-effort khi lỗi.
Storage lỗi có retry; nguồn thiếu/hỏng/chồng lấn fail với code rõ ràng, meeting
vẫn completed. Giữ nguyên các chunk học giọng khi tạo băng thành công.

Không ép các khoảng thời gian về nối liền: khoảng hở giữa recording IDs được
đệm im lặng và báo tổng gap trong `warning`; thiếu đầu hoặc hở bên trong cùng
recording ID bị từ chối. Không đoán giọng/nội dung đã mất, không khẳng định toàn
bộ khoảng hở là tạm dừng. Thời lượng media theo audio thực và timeline được lưu.

## API và quyền

- `GET /meetings/{id}/recording`: read ACL; **không tạo job**. Trả
  `{status,media,job,can_prepare,warning}`. Status: not_completed, unavailable,
  pending, ready, failed, deleted. Job dùng JobResponse hiện tại, media không lộ key.
- `POST /meetings/{id}/recording`: edit ACL, realtime completed. Dùng để chuẩn
  bị meeting cũ hoặc thử lại failed job; khóa meeting chống request lặp, tái dùng
  active/ready job, failed tạo snapshot/job mới. Trả 202 RecordingResponse.
- Meeting cũ có chunk được khôi phục **theo thao tác explicit**, không có chunk
  báo unavailable. Không tái tạo từ transcript. Read/comment được nghe nhưng
  không tạo/thử lại job. Media đã xóa không được tự hồi sinh.
- Media được lưu bền, GET sau reload vẫn ready. Phát dùng playback-url ACL hiện
  tại, ticket/presigned URL TTL; local ticket hỗ trợ Range 206 và stream các phần
  tối đa 1MiB. Nút tải dùng endpoint download có ACL (đã sửa Request bị thiếu),
  local stream 1MiB, S3 dùng presigned attachment URL như trước.
- Owner xóa MediaFile của recording_assembly: xóa cả object tổng và raw chunks,
  soft-delete media giữ tombstone; prepare sau đó từ chối. Xóa meeting vẫn purge
  cả media/chunks. Audio mẫu giọng đã tạo trước đó thuộc thư viện độc lập.

## Frontend

Nút Nghe lại (volume) thứ tám trên toolbar, có tooltip trạng thái/pending marker.
Chưa kết thúc khóa nút; trạng thái mạng lỗi không được trình bày thành thiếu
audio. GET pending poll 2s, unfinished 10s, read error 5s; terminal ngừng poll,
refresh khi focus/completion event. Chỉ nút Chuẩn bị/Thử lại mới POST.

Bấm mở panel nhỏ phía trên các icon qua stable toolbar portal host. Không dựng
lại player lớn trên transcript, không điều hướng hoặc unmount capture. Có native
play/pause/seek/time, speed 0.75–2x, tải băng và thông báo lỗi/retry. Mở không tự
phát; đóng/Escape pause và trả focus. URL chỉ lấy khi mở, đọc theo Range, không
tải toàn bộ băng vào blob lúc mở. Tải xuống explicit mới nhận blob ở client.
URL hết hạn được làm mới có giới hạn; giữ mốc tua, không tự lặp refresh vô hạn.

Bấm timestamp phát scoped playback-seek event để mở/tua/phát theo thao tác của
người dùng. Time updates phát scoped event để highlight transcript. Sidebar/modal
không thay host/player; ResizeObserver tính cả panel/alerts vào khoảng chừa dưới.

## Xác minh và giới hạn

Tests dùng PCM tổng hợp/SQLite/provider giả: flush/end, idempotency, byte exact,
pause/reconnect gap, nguồn hỏng/thiếu/overlap/changed, retry/queue offline, ACL,
download/Range/ticket và deleted tombstone; build và frontend SSR/source checks.
Vẫn cần browser/microphone/mobile và storage S3/PostgreSQL thực sau rebuild.
Queue chưa có execution lease recovery cho worker bị kill khi processing (giới
hạn chung hiện có). DB/object storage không atomic; cleanup object là best-effort.
