# API Specification v2

## Decisions đã chốt

-   **Phân quyền:** không có global Admin trong web demo. Mỗi meeting có
    `owner` và cộng tác viên theo ACL `read | comment | edit`. Đây là
    phân quyền theo tài nguyên, cần thiết vì hệ thống có chia sẻ/cộng
    tác.
-   **Đăng ký:** email + password và bắt buộc xác minh email bằng OTP
    trước khi kích hoạt đầy đủ.
-   **Google Login:** Google OAuth thật.
-   **Upload demo:** tối đa **500 MB/file** và **2 giờ/file**, cấu hình
    bằng environment. Hỗ trợ đầu vào phổ biến:
    `mp3, wav, m4a, aac, flac, ogg, opus, webm, mp4, mov, mkv, avi, mpeg/mpg`.
    Backend dùng **FFmpeg** để probe/normalize audio trước STT, vì
    provider không nhất thiết nhận mọi container/codec.
-   **STT:** kiến trúc provider mở. Demo phải có ít nhất một adapter
    thật; provider được chọn qua config. Capability model quyết định
    `batch`, `streaming`, `diarization`, `languages`, `timestamps`,
    `confidence`.
-   **Ngôn ngữ STT:** demo bảo đảm Việt + Anh; kiến trúc hỗ trợ mở rộng
    multilingual theo capability provider.
-   **Diarization:** bắt buộc trong demo nếu provider được chọn hỗ trợ;
    UI hiển thị Speaker 1, Speaker 2...
-   **Translation:** provider mở; demo bảo đảm VI ↔ EN; mở rộng
    multilingual theo provider.
-   **LLM:** provider mở; không hard-code vendor/model vào business
    service.
-   **Summary:** `general`, `briefing`, `voting`.
-   **Export:** PDF, DOCX, TXT, SRT, VTT, JSON.
-   **Share:** `read`, `comment`, `edit`.
-   **Retention:** không tự xóa audio theo thời gian trong demo; user có
    thể xóa audio hoặc meeting.
-   **Delete meeting:** xóa toàn bộ dữ liệu phụ thuộc và object storage
    liên quan.
-   **Versioning:** giữ lịch sử transcript và summary. Không overwrite
    version cũ.
-   **Xin ý kiến:** loại khỏi scope.
-   **Deploy demo:** ưu tiên **Render** cho frontend static, FastAPI web
    service, background worker, PostgreSQL và Redis-compatible Key
    Value; object storage dùng S3-compatible managed storage bên ngoài.
    Kiến trúc không phụ thuộc Render.
-   **Frontend:** không tiếp tục maintain bundle `script.js`; agent dựng
    lại source React/TypeScript maintainable từ UI hiện tại.

Base: `/api/v1`

## 1. Auth

``` text
POST /auth/register
POST /auth/verify-email-otp
POST /auth/resend-email-otp
POST /auth/login
GET  /auth/google/start
GET  /auth/google/callback
POST /auth/refresh
POST /auth/logout
POST /auth/forgot-password
POST /auth/reset-password
GET  /auth/me
```

Email/password account creation returns an unverified user and sends a hashed-at-
rest OTP through the configured email adapter. Login requires `is_email_verified`.
Access and refresh tokens are stateless signed JWTs: clients send access tokens as
`Authorization: Bearer <token>` and submit the refresh token in the request body.
`POST /auth/logout` clears client state; server-side token revocation requires a
future persisted session/revocation design.

Google OAuth uses the authorization-code flow. `GET /auth/google/start` redirects
to Google; its callback validates an HttpOnly signed state cookie, requires a
verified Google email, then redirects to the configured frontend origin using a
URL fragment. No token is placed in a query parameter.

## 2. Meetings

``` text
POST   /meetings
GET    /meetings
GET    /meetings/{id}
PATCH  /meetings/{id}
DELETE /meetings/{id}
```

## 3. Collaboration / permissions

``` text
GET    /meetings/{id}/members
POST   /meetings/{id}/members
PATCH  /meetings/{id}/members/{user_id}
DELETE /meetings/{id}/members/{user_id}

POST   /meetings/{id}/shares
GET    /meetings/{id}/shares
PATCH  /shares/{share_id}
DELETE /shares/{share_id}
```

Permission:

``` json
{"permission":"read|comment|edit"}
```

Member creation accepts exactly one of `email` or `user_id`; the target must be
an existing account. Member and share-link management is owner-only. Creating a
share returns its raw high-entropy token once and persists only a SHA-256 hash;
subsequent list/read responses never reveal it. `DELETE /shares/{share_id}`
revokes the link (rather than hard-deleting its audit record).

## 4. Media

``` text
POST   /meetings/{id}/media
GET    /meetings/{id}/media
POST   /meetings/{id}/media/{media_id}/playback-url
GET    /meetings/{id}/media/{media_id}/stream
GET    /meetings/{id}/media/{media_id}/download
DELETE /meetings/{id}/media/{media_id}
```

Default backend limits: - 500 MB - 2 hours - configurable

Accepted containers/extensions:
`mp3 wav m4a aac flac ogg opus webm mp4 mov mkv avi mpeg mpg`

Backend uses ffprobe/FFmpeg and rejects corrupt/unreadable media even if
extension matches.

`POST /meetings/{id}/media` requires `edit`; `GET` requires `read`; deleting
media requires ownership. The upload response is a durable `Job` with the
linked `media_file_id`, initially `queued` at progress `0`. It remains queued
until a configured worker claims it; the API never reports a fabricated result.
Deleting a media file fails any queued or processing job tied to that source.
Stream and download require `read` access. Stream accepts a single HTTP `Range`
and returns `206` plus `Content-Range`, enabling seeking without exposing a
storage path or public object URL. With S3-compatible storage, playback and
download resolve to short-lived private presigned GET URLs only after the same
ACL check; local development retains the authenticated proxy behavior.

## 5. Provider capability endpoint

``` text
GET /capabilities
```

Example:

``` json
{
  "stt": {
    "provider": "configured-provider",
    "batch": true,
    "streaming": true,
    "diarization": true,
    "languages": ["vi","en"]
  },
  "translation": {
    "languages": ["vi","en"]
  },
  "summary_templates": ["general","briefing","voting"],
  "exports": ["pdf","docx","txt","srt","vtt","json"]
}
```

Frontend dùng endpoint này để enable/disable provider-dependent
features.

## 6. Jobs

``` text
GET /jobs/{id}
```

States: `queued | processing | retrying | completed | failed`.

Jobs expose `id`, `meeting_id`, optional `media_file_id`, `job_type`, `status`,
`progress` (0–100), optional `{code, message}` error, and timestamps. A caller
may only query jobs belonging to a meeting they can read.

## 7. Transcript & versions

``` text
GET  /meetings/{id}/transcript
GET  /meetings/{id}/transcript/versions
GET  /meetings/{id}/transcript/versions/{version_id}

PATCH  /segments/{logical_segment_id}
DELETE /segments/{logical_segment_id}
POST   /segments/{logical_segment_id}/split
POST   /segments/merge
```

Mỗi edit tạo transcript version mới; response trả `version_id`.

`GET /meetings/{id}/transcript` returns the current immutable snapshot with
chronologically ordered normalized segments (`id`/`logical_segment_id`,
`start_ms`, `end_ms`, `text`, nullable `speaker_id`, and nullable
`confidence`). `GET /versions` is newest first; a specific version returns the
same snapshot shape. Segment mutation responses include the newly current
`version_id` and `version_no`. Split accepts `split_at_ms` and optional split
texts; merge accepts `first_segment_id` and `second_segment_id`, which must be
contiguous adjacent segments assigned to the same speaker.

## 8. Speakers

``` text
GET   /meetings/{id}/speakers
POST  /meetings/{id}/speakers
PATCH /speakers/{id}
GET   /speakers/{id}/sample
PATCH /segments/{logical_segment_id}/speaker
```

Speaker records are meeting-scoped. Creating/updating speaker metadata does
not assert real-world identity. Assigning (including unassigning) a speaker to
a segment creates a transcript snapshot revision.
`GET /speakers/{id}/sample` requires `read` access and returns an existing
media ID plus a real transcript interval (`start_ms`, `end_ms`). It returns
`SPEAKER_SAMPLE_UNAVAILABLE` when no retained media or matching segment exists.

## 9. Comments

``` text
GET    /meetings/{id}/comments
POST   /meetings/{id}/comments
PATCH  /comments/{id}
DELETE /comments/{id}
GET    /shares/{token}
GET    /shares/{token}/transcript
```

`GET /shares/{token}/transcript` validates the high-entropy capability token,
including revocation and expiry, then returns only the current transcript
snapshot and share-safe meeting metadata. It does not grant access to internal
comments, versions, exports, media, or storage URLs.

## 10. Translation

``` text
POST /meetings/{id}/translations
GET  /meetings/{id}/translations
GET  /translations/{id}
```

Demo requires `vi ↔ en`. API schema accepts BCP-47 language codes for
future multilingual support.

Creation returns a durable `202` Job. The request snapshots the meeting's
current transcript version; a worker invokes the configured provider and,
only on success, persists a separate segment-aligned translation. `GET`
endpoints require meeting read access. Job errors include a stable code and a
retryability flag.

## 11. Summary & versions

``` text
POST /meetings/{id}/summaries
GET  /meetings/{id}/summaries
GET  /summaries/{id}
GET  /summaries/{id}/versions
GET  /summaries/{id}/versions/{version_id}
```

Templates: `general | briefing | voting`

Regenerate → new summary version.

`POST /meetings/{id}/summaries` returns a `202` Job. Repeating a template for
the same transcript input appends an immutable `SummaryVersion` rather than
overwriting it. Summary reads return the latest version and the version routes
expose the immutable history.

## 12. Export

``` text
POST /meetings/{id}/exports
GET  /exports/{id}
GET  /exports/{id}/download
```

Formats: `pdf | docx | txt | srt | vtt | json`

Export requests return `202` with a durable job. `GET /exports/{id}` reports
that job's state; downloading is authorized with meeting `read` access and is
available only after completion.

## 13. Realtime

``` text
WSS /realtime/{meeting_id}
```

With the API base prefix, the implemented URL is
`WS /api/v1/realtime/{meeting_id}?access_token=<access JWT>`. The access token
authorizes the WebSocket only; STT API keys remain backend-only. The caller must
have `edit` permission.

Server events: `session.ready`, `transcript.partial`, `transcript.final`,
`meeting.status`, and `error`. Transcript events contain normalized
`language`, `start_ms`, `end_ms`, `text`, optional `speaker_label` and
`confidence`; final events also include `logical_segment_id`. Error events use
`{type:"error", code, message, retryable}`.

Client sends binary audio chunks and JSON commands
`{"type":"recording.pause"}`, `{"type":"recording.resume"}`, or
`{"type":"recording.stop"}`. A partial is never persisted. A final is stored
as a `SegmentVersion` in a new/current STT transcript version. Stop or client
disconnect leaves the meeting `processing`; it does not mark a meeting or job
`completed`. A non-retryable provider failure marks the meeting `failed`; a
retryable error keeps the socket available for another chunk/command.

Realtime endpoint checks configured STT capability. Nếu
`streaming=false`, return explicit unsupported capability; không giả
realtime.

## 14. Authorization matrix

  Action                           read   comment   edit   owner
  ------------------------------ ------ --------- ------ -------
  View/playback                       ✓         ✓      ✓       ✓
  Export                              ✓         ✓      ✓       ✓
  Comment                            \-         ✓      ✓       ✓
  Edit transcript/speaker            \-        \-      ✓       ✓
  Generate translation/summary       \-        \-      ✓       ✓
  Manage members/share               \-        \-     \-       ✓
  Delete meeting/media               \-        \-     \-       ✓

## 15. Errors

Use stable codes: - `AUTH_REQUIRED` - `EMAIL_NOT_VERIFIED` -
`PERMISSION_DENIED` - `UPLOAD_TOO_LARGE` - `MEDIA_UNSUPPORTED` -
`MEDIA_INVALID` - `MEDIA_PROBE_UNAVAILABLE` - `MEDIA_STORAGE_ERROR` -
`PROVIDER_CAPABILITY_UNAVAILABLE` -
`STT_PROVIDER_ERROR` - `TRANSLATION_PROVIDER_ERROR` -
`LLM_PROVIDER_ERROR` - `VERSION_CONFLICT`
