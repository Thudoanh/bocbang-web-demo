# ERD v2

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

## 1. Core relationships

``` text
USER 1---N MEETING(owner)
USER N---N MEETING via MEETING_MEMBER(permission)

MEETING 1---N MEDIA_FILE
MEETING 1---N JOB
MEETING 1---1 TRANSCRIPT
TRANSCRIPT 1---N TRANSCRIPT_VERSION
TRANSCRIPT_VERSION 1---N SEGMENT_VERSION
MEETING 1---N SPEAKER

MEETING 1---N COMMENT
MEETING 1---N TRANSLATION
MEETING 1---N SUMMARY
SUMMARY 1---N SUMMARY_VERSION
MEETING 1---N EXPORT
MEETING 1---N SHARE_LINK
```

## 2. Access control

### meeting_members

``` text
meeting_id UUID FK
user_id UUID FK
permission ENUM(read, comment, edit)
created_at
UNIQUE(meeting_id, user_id)
```

Owner nằm ở `meetings.owner_id`, không duplicate thành member.

### share_links

``` text
id UUID PK
meeting_id UUID FK
token_hash VARCHAR UNIQUE
permission ENUM(read, comment, edit)
expires_at TIMESTAMPTZ NULL
revoked_at TIMESTAMPTZ NULL
created_by UUID FK users
created_at
```

## 3. Auth

### users

``` text
id UUID PK
email VARCHAR UNIQUE
password_hash VARCHAR NULL
google_subject VARCHAR UNIQUE NULL
full_name VARCHAR
is_email_verified BOOLEAN
created_at
updated_at
```

### email_otps

``` text
id UUID PK
user_id UUID FK
purpose ENUM(verify_email, reset_password)
code_hash VARCHAR
expires_at TIMESTAMPTZ
consumed_at TIMESTAMPTZ NULL
attempt_count INTEGER
created_at
```

Không lưu OTP plaintext.

## 4. Meeting/media

### meetings

``` text
id UUID PK
owner_id UUID FK
title
description
source_type ENUM(realtime, upload)
language_mode VARCHAR
diarization_enabled BOOLEAN
status ENUM(created, recording, processing, completed, failed)
duration_ms BIGINT NULL
current_transcript_version_id UUID NULL
created_at
updated_at
```

### media_files

``` text
id UUID PK
meeting_id UUID FK
original_filename
mime_type
size_bytes
duration_ms
storage_key
normalized_storage_key NULL
status
created_at
deleted_at NULL
```

## 5. Transcript versioning

### transcripts

``` text
id UUID PK
meeting_id UUID UNIQUE FK
created_at
```

### transcript_versions

``` text
id UUID PK
transcript_id UUID FK
version_no INTEGER
source ENUM(stt, user_edit)
parent_version_id UUID NULL
created_by UUID NULL
created_at
UNIQUE(transcript_id, version_no)
```

### segment_versions

``` text
id UUID PK
transcript_version_id UUID FK
logical_segment_id UUID
speaker_id UUID NULL
sequence INTEGER
start_ms BIGINT
end_ms BIGINT
text TEXT
original_stt_text TEXT NULL
confidence DOUBLE NULL
```

MVP có thể snapshot toàn bộ segment list mỗi version để implementation
rõ ràng. Tối ưu delta/version diff để phase sau.

## 6. Speaker

``` text
speakers:
id
meeting_id
provider_speaker_id
name
role
organization
is_identified
created_at
updated_at
```

## 7. Comments

``` text
comments:
id UUID PK
meeting_id UUID FK
segment_logical_id UUID NULL
author_id UUID FK
body TEXT
created_at
updated_at
deleted_at NULL
```

`comment` permission cho phép tạo/sửa/xóa comment của chính mình, không
sửa transcript.

## 8. Summary versioning

``` text
summaries:
id
meeting_id
transcript_version_id
template_type
created_at

summary_versions:
id
summary_id
version_no
content JSONB
provider
model
created_by
created_at
```

## 9. Translation/export/job

Giữ entity: - `translations` - `translation_segments` - `exports` -
`jobs`

Mỗi output phải ghi input transcript version để truy vết.

Persistence baseline lưu tối thiểu `meeting_id` cho cả bốn entity; `translations`,
`summaries` và `exports` lưu `transcript_version_id`. Translation lưu cặp ngôn
ngữ BCP-47 và snapshot theo `logical_segment_id`; export lưu `format`; job lưu
trạng thái `queued | processing | completed | failed`. Media-processing jobs
cũng lưu `media_file_id` (nullable cho future job types), `job_type`,
`progress`, `error_code` và `error_message` để client theo dõi tác vụ durable.
Các field payload, kết quả provider và storage output còn lại sẽ được xác định
cùng các vertical slice tương ứng, không suy diễn trước ở persistence baseline.

## 10. Delete rule

Owner delete meeting → toàn bộ DB entities thuộc meeting bị xóa/cascade
theo transaction + storage objects được cleanup. User cũng có endpoint
xóa media riêng mà vẫn giữ transcript/version nếu muốn.
