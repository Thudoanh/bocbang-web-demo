# Frontend rebuild — trạng thái hiện tại

_Cập nhật theo source: 2026-10-08._

Frontend rebuild đã thực hiện trong `frontend/`: React + TypeScript + Vite,
REST/WebSocket thật, job polling và ACL. `prototype/` là bundle HTML/CSS/JS cũ
có mock data, chỉ dùng reference. Không tiếp tục phát triển feature trong bundle.

## Đã có trong code

- Auth routes riêng login/register/forgot-password, OTP/recovery/Google handoff.
- Danh sách/tạo meeting riêng realtime/upload; History filter phía server.
- AudioWorklet PCM16 mono 16 kHz; socket start/pause/resume/stop/reconnect.
- Partial/final transcript, speaker correction, optional transient VI ↔ EN.
- Transcript edit/timing/speaker, split/merge/delete, version history/rollback.
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
- Realtime hiện không giữ audio recording; audio replay dùng retained uploads.

Không coi build hoặc static reference review là browser acceptance. Xem
[QA checklist](phase-4-qa.md) và
[Current Status](../../project_context/CURRENT_STATUS.md).
