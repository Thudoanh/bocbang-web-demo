# Học giọng từ cuộc họp đã xác nhận

Người tham gia bắt đầu họp ngay; thu mẫu trước cuộc họp là tùy chọn. Thư ký có
quyền edit chọn `Gán tên / Lưu giọng` trên một đoạn transcript đã lưu, nghe lại,
chọn thêm các đoạn của cùng người và nhập tên hoặc chọn hồ sơ đã có.

- `Chỉ gán tên` dùng luồng sửa người nói hiện có; không tạo voiceprint.
- `Gán tên và lưu mẫu giọng` tạo durable job `voice_learning`, theo dõi qua
  `GET /jobs/{id}`. Giao diện đóng hộp thoại để cuộc họp tiếp tục trong lúc xử lý.
- Cần ít nhất 10 giây âm thanh; có thể ghép tối đa 50 đoạn, lấy tối đa 25 giây
  theo thứ tự thời gian. Chỉ các khoảng được chọn được gửi đi, bỏ khoảng trống
  giữa chúng. Speechmatics kiểm tra mẫu chỉ có một người nói trước khi trả
  identifier. Không tự học từ nhãn do AI dự đoán hoặc từ transcript văn bản.
- Khi thành công, profile/sample audio, tên người nói, transcript edit events
  và trạng thái job được commit cùng transaction. Các đoạn xác nhận được bảo
  vệ khỏi speaker revision tự động. Tên trên speaker áp dụng cho các đoạn đang
  tham chiếu speaker đó; chỉ các đoạn đánh dấu được dùng làm dữ liệu mẫu.

## Âm thanh nguồn

Realtime server lưu PCM16 mono 16 kHz nhận từ WebSocket thành các WAV nhỏ trong
private storage, mỗi 5 giây và khi pause/stop/disconnect. Bảng
`meeting_audio_chunks` chứa meeting ID, recording ID, start/end milliseconds và
storage key. Timeline tiếp tục qua pause/reconnect, gồm cả các khoảng im lặng
đã thu; các đoạn chưa lưu đủ trả `MEETING_AUDIO_NOT_READY`. Giới hạn thời lượng
ghi dùng `MAX_MEDIA_DURATION_SECONDS`. Audio realtime cũ trước khi có tính năng
này không được tái tạo từ transcript. UI nghe lại các đoạn đã chọn; chưa có
player/tệp tổng hợp toàn bộ audio realtime.

Với cuộc họp upload đã có transcript, reader lấy audio từ file nguồn được ghi
trên payload media-processing job qua `transcript_version_id`; theo parent
revision và rollback để giữ đúng nguồn. Một file nguồn chỉ tải xuống một lần
cho mỗi yêu cầu trích; FFmpeg trim/concat các khoảng thành một mẫu. Cuộc họp cũ
chưa có provenance chỉ tự lấy khi có đúng một tệp hoàn tất còn được lưu. Nếu
nhiều tệp không xác định được nguồn, trả `MEETING_AUDIO_AMBIGUOUS` thay vì đoán.

## API và quyền

`POST /meetings/{id}/voice-learning/preview` nhận `{segment_ids: [uuid, ...]}`,
yêu cầu read, trả WAV ghép từ các khoảng đã xác minh, `Cache-Control: no-store`.

`POST /meetings/{id}/voice-learning` yêu cầu edit và enrollment provider:

```json
{"segment_ids": ["uuid"], "name": "Nguyễn Văn Nam", "profile_id": null}
```

Trả `202 JobResponse`. `profile_id` trống tạo hồ sơ mới thuộc chủ cuộc họp;
profile chỉ định phải là thư viện của chủ cuộc họp hoặc người xác nhận. Có thể
bổ sung tối đa ba mẫu/profile. Lưu clip snapshot vào private storage trước khi
enqueue; worker kiểm tra lại ACL và segment IDs/timestamps/speaker IDs trước
và sau external call. Đoạn bị sửa/xóa hoặc mất quyền sẽ làm job thất bại, không
lưu mẫu/gán tên. Lỗi provider retryable đi qua lifecycle/reconciler hiện có.
Clip tạm được xóa khi job đạt terminal state.

Hồ sơ tái sử dụng được chọn từ owner/members của cuộc họp và khách riêng của
cuộc họp; không đưa thư viện người dùng không liên quan vào nhận diện. Các route
quản lý profile cá nhân chỉ cho chủ profile sửa/xóa. Profile đã học tồn tại độc
lập với cuộc họp nguồn để dùng trong tương lai. Xóa cuộc họp dọn audio chunks,
clip job và metadata; không xóa hồ sơ tái sử dụng độc lập đã tạo.

## Áp dụng trong phiên đang ghi

Sau khi job hoàn tất, frontend gửi `{"type":"speakers.refresh"}` trên socket
đang mở. Backend chốt output upstream cũ, mở upstream với known speakers mới,
đặt offset theo PCM clock và trả `speakers.updated` cùng capability/fallback
thực tế. Trạng thái pause được giữ nguyên, meeting/socket không hoàn tất.
Speechmatics dùng identifiers cho các lượt tiếp theo; nếu fallback không hỗ
trợ identification, UI giữ cảnh báo và mẫu vẫn dùng cho phiên hỗ trợ sau này.

Tài liệu cấu hình known speakers:
[Speechmatics Voice SDK](https://docs.speechmatics.com/integrations-and-sdks/voice-sdk).
Không thay đổi vendor SDK/version trong đợt này.

## Kiểm tra

Regression tests: `tests/test_voice_learning.py`, live WebSocket → preview →
durable job → refresh trong `tests/test_realtime.py`, migration/model suites.
Provider được mô phỏng, không khẳng định độ chính xác trên giọng thật.
`scripts/check_meeting_voice_clip.py` kiểm tra FFmpeg thật bằng audio tổng hợp,
không cần database, credentials hoặc mạng. Cần rebuild API/worker/frontend và
migration `20261020_0016` rồi kiểm thử microphone/provider thực tế.
