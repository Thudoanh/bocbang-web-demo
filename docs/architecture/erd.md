# ERD v2

_Đối chiếu SQLAlchemy models và Alembic head `20261020_0017`: 2026-10-20._

## 1. Core relationships

``` text
USER 1---N MEETING(owner)
USER N---N MEETING via MEETING_MEMBER(permission)

MEETING 1---N MEDIA_FILE
MEETING 1---N MEETING_SECTION
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
TRANSCRIPT 1---N CURRENT_SEGMENT
TRANSCRIPT_VERSION 1---N TRANSCRIPT_EDIT_EVENT
USER 1---0..1 VOICE_PROFILE(personal)
MEETING 1---N VOICE_PROFILE(guest)
VOICE_PROFILE 1---N SPEAKER(optional)
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

`meeting_sections` (0017): UUID PK, meeting_id FK CASCADE + index, sequence,
title VARCHAR(255), start_ms BIGINT, end_ms BIGINT nullable, is_started BOOLEAN,
created_at/updated_at. Unique(meeting_id,sequence); check start>=0,end>=start.
No inferred historical session splits: old meetings backfill one session.
Manual create/update/delete only edits these grouping rows: split at recorded
timestamp, shift neighboring boundaries, or merge deleted interval into a neighbor.
There is deliberately no section FK/cascade on transcript, audio or summary
versions. Sequence renumbering uses a two-phase flush to preserve uniqueness.
The API revision is a computed layout hash, not a new DB column/migration.
See [session timeline/data model](meeting-sessions.md).

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

Implementation dùng `current_segments` projection cho trạng thái hiện tại và
append-only `transcript_edit_events` cho edit/rollback/correction. Lịch sử được
dựng từ STT/checkpoint snapshots và edit events; không phải mỗi edit sao chép
toàn bộ `segment_versions`.

```text
transcripts.current_projection_initialized_at TIMESTAMPTZ NULL
transcript_versions.checkpointed_at TIMESTAMPTZ NULL

current_segments:
id UUID PK
transcript_id UUID FK
logical_segment_id UUID UNIQUE
speaker_id UUID NULL FK
position NUMERIC(30,15)
start_ms BIGINT
end_ms BIGINT
text TEXT
original_stt_text TEXT NULL
confidence FLOAT NULL
created_at, updated_at
UNIQUE(transcript_id, position)

transcript_edit_events:
id UUID PK
transcript_id UUID FK
version_id UUID FK
actor_id UUID NULL FK
event_order INTEGER
event_type VARCHAR(32)
payload JSON
created_at
UNIQUE(version_id, event_order)
```

Current pointer nằm ở `meetings.current_transcript_version_id`.

## 6. Speaker

``` text
speakers:
id
meeting_id
provider_speaker_id
voice_profile_id UUID NULL FK (ON DELETE SET NULL)
match_confidence FLOAT NULL
name
role
organization
is_identified
created_at
updated_at
```

### Voice profiles

```text
voice_profiles:
id UUID PK
user_id UUID NULL FK (ON DELETE SET NULL, unique non-null)
meeting_id UUID NULL FK (ON DELETE CASCADE)
name VARCHAR(255)
sample_duration_ms INTEGER
audio_storage_path VARCHAR(512) NULL
speaker_identifiers JSON
provider VARCHAR(32)
sample_count INTEGER
created_at, updated_at
```

Personal profile có user_id và meeting_id null; guest có meeting_id và user_id
null. Service giới hạn ba identifiers/profile, không trả identifiers/audio path
qua REST. Sample WAV của profile được lưu trong private storage. Học từ cuộc
họp tạo job `voice_learning`, lưu clip snapshot tạm và nguồn đoạn/timestamps/
người xác nhận trong payload; profile đã học thuộc thư viện của chủ cuộc họp.

Bảng `meeting_audio_chunks` (migration `0016`) có UUID primary key, meeting FK
cascade, recording UUID, `start_ms`, `end_ms`, unique `storage_key`, `created_at`
và constraint `end_ms > start_ms`. Audio chunks được dọn khi xóa meeting; profile
tái sử dụng tồn tại độc lập. Xem [luồng học giọng](meeting-voice-learning.md).
Migration `0012` xóa profile MFCC cũ và thay representation bằng Speechmatics.

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
mode VARCHAR(16)
scope VARCHAR(16) -- meeting | sessions; legacy/default meeting
template_type
output_language VARCHAR(2)
created_at
UNIQUE(meeting_id, transcript_version_id, scope, mode, template_type, output_language)

summary_versions:
id
summary_id
version_no
prompt TEXT
content JSON
provider
model
created_by
created_at
```

`mode` là `template` hoặc `custom`; custom vẫn dùng `template_type=general` như
giá trị nội bộ tương thích schema cũ, nhưng API trả `template: null`.

## 9. Translation/export/job

Giữ entity: - `translations` - `translation_segments` - `exports` -
`jobs`

Mỗi output phải ghi input transcript version để truy vết.

Models hiện có các field phục vụ xử lý và kết quả:

- `translations`: meeting/input version, source/target language, created_at;
  `translation_segments`: translation_id, logical_segment_id, sequence, text.
- `exports`: meeting/input version, format, storage_key, content_type, filename,
  created_at. Job export lưu reference/options trong payload.
- `jobs`: meeting_id, media_file_id nullable, job_type, status, progress,
  error_code/message/retryable, payload JSON, attempts, started_at,
  next_attempt_at, completed_at, created_at/updated_at.
- Job status: `queued | processing | retrying | completed | failed`.
  PostgreSQL là authority; Redis message chỉ chứa job ID.
- Dịch realtime không lưu vào translation tables.
- `recording_assembly` dùng jobs payload snapshot chunk IDs/keys/timing/recording
  IDs và kết quả gap_ms; job.media_file_id trỏ MediaFile WAV sau thành công,
  cùng transaction job completed. Không thêm column/table/migration. Raw chunks
  vẫn phục vụ học giọng; owner xóa băng tổng thì xóa chunks và giữ tombstone media.
  Xem [recording playback](recording-playback.md).

## 10. Delete rule

Job type `transcript_polish` lưu snapshot nguồn, đề xuất AI, bản nháp/revision,
requester và accepted version/user/time trong JSON payload; không thêm table hay
migration. Chốt tạo transcript user_edit/checkpoint và edit events gắn proposal;
commit cùng accepted pointer của job. Source/generated không bị overwrite bởi
review. Xem [data lifecycle](transcript-polish.md).

Owner delete meeting → toàn bộ DB entities thuộc meeting bị xóa/cascade
theo transaction + storage objects được cleanup. User cũng có endpoint
xóa media riêng mà vẫn giữ transcript/version nếu muốn.
