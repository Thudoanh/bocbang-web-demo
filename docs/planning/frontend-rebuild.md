# Frontend rebuild — trạng thái hiện tại

_Cập nhật theo source: 2026-10-08._

Frontend rebuild đã thực hiện trong `frontend/`: React + TypeScript + Vite,
REST/WebSocket thật, job polling và ACL. `prototype/` là bundle HTML/CSS/JS cũ
có mock data, chỉ dùng reference. Không tiếp tục phát triển feature trong bundle.

## Đã có trong code

- Auth routes riêng login/register/forgot-password, OTP/recovery/Google handoff.
- Danh sách/tạo meeting riêng realtime/upload; History filter phía server.
- AudioWorklet PCM16 mono 16 kHz; socket start/pause/resume/stop/reconnect.
- Pause opens a two-choice native dialog: new pending session or same-session
  pause; Close/Escape use same-session pause. No capture command on open. Both
  paths flush capture and use opt-in pause/resume ACK before UI/capture restart.
- Slim Bản ghi header uses actual meeting title/metadata/actions, no repeated
  Bản ghi title. Sidebar toggle outside the panel on all authenticated pages;
  desktop collapse persists locally, mobile drawer state is independent.
  Layout-only visibility changes preserve editors/recording/portal hosts and
  recenter the bottom toolbar without routing or capture lifecycle operations.
- Partial/final transcript, speaker correction, optional transient VI ↔ EN.
- Realtime translation display: hidden = original full width; enabled = original
  left/translation right, equal tracks and paired row heights by logical ID,
  matching metadata and honest empty/partial placeholders. Shared page scroll;
  hide restores one column. Capture/socket translation workflow unchanged.
- Transcript edit/timing/speaker, split/merge/delete. Trang Bản ghi một cột,
  bỏ Thông tin/Bình luận/Phiên bản và không có nút mở thay thế. Lịch sử/revision
  backend vẫn giữ, không xóa dữ liệu hoặc thay ACL/API.
- Audio player cho uploaded media với signed playback URL, seek theo segment,
  highlight đoạn đang phát và playback speed.
- Speakers, voice enrollment trước phiên, personal profiles trong Settings;
  Speechmatics name identification và AssemblyAI fallback warning.
- Saved translation/summary, output language VI/EN, export sáu formats.
- Members/share theo owner ACL; public metadata/current transcript read-only.
- Sửa full name, owner delete media/meeting và confirmation.

Cấu trúc source, routes, setup và build nằm ở [frontend README](../../frontend/README.md).
Reference/visual requirements nằm ở [UI spec](../ui/UI_SPEC.md).

## Nguyên tắc duy trì

API/provider capability là authority, không hard-code dữ liệu nghiệp vụ hay
fabricate kết quả. Backend giữ secrets; Vite chỉ có public config. Frontend
pre-check upload extension/size, backend kiểm tra duration/codec/validity.
Quyền collaborator theo `read/comment/edit`; owner quản lý share/members/delete.

## Phần còn lại

- Browser/microphone E2E với provider thật; kiểm tra playback signed URL expiry,
  reconnect, permission/error states, latency và accuracy.
- History pagination UI và total/count contract nếu dữ liệu tăng.
- Public summary/translation/media và token-based comment/edit cần ACL thiết kế
  riêng; link hiện có permission metadata không tự cấp các chức năng này.
- Settings preferences/retention/storage metadata cần API/schema trước khi thêm UI.
- Realtime giữ audio chunks và sau explicit end worker ghép băng WAV bền vững;
  Nghe lại trên toolbar mở mini player, hỗ trợ cả retained upload. Meeting cũ
  chỉ khôi phục khi còn chunks; xem [playback](../architecture/recording-playback.md).

Không coi build hoặc static reference review là browser acceptance. Xem
[QA checklist](phase-4-qa.md) và
[Current Status](../../project_context/CURRENT_STATUS.md).
