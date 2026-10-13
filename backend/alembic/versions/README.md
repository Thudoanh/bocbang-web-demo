# Migration revisions

Schema đã có chuỗi migration từ `20260930_0001` đến `20261008_0012`.
Chạy từ `backend/` với root `.env` đã cấu hình `DATABASE_URL`:

```powershell
alembic current
alembic heads
alembic upgrade head
```

| Revision | Thay đổi |
| --- | --- |
| `0001` | Persistence ban đầu: auth, meeting ACL, media, job, transcript/speaker, AI, export/share. |
| `0002` | Unique Google subject. |
| `0003` | Metadata media job. |
| `0004` | AI job payload. |
| `0005` | Storage metadata export. |
| `0006` | Performance indexes. |
| `0007` | Current transcript projection, edit events và checkpoint. |
| `0008` | Job lifecycle/retry metadata. |
| `0009` | Job reconciliation. |
| `0010` | Summary output language và uniqueness theo language. |
| `0011` | Voice profiles và liên kết speaker (schema nhận diện cũ). |
| `0012` | Speechmatics identifiers, provider/sample count; bỏ MFCC cũ. |

Head hiện tại: `20261008_0012`. Migration `0012` xóa voice profile cũ để đổi
representation; cần enrollment lại. Giữ `0011` trong lịch sử migration.
Compose chạy `migrate` trước API/worker/reconciler; database đã có cần chạy
`docker compose run --rm migrate` khi cập nhật schema. Dùng database test độc
lập cho migration tests.
