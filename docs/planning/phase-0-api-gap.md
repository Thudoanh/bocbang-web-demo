# Phase 0 — BA/API/frontend gap decision record

Originally recorded: 2026-10-01. Source reconciliation: 2026-10-08.
The Phase 1 decisions remain a historical record; gap status below reflects
current code, not a new browser acceptance run.

## Decisions implemented in Phase 1

| BA requirement | Backend contract | Frontend implementation |
| --- | --- | --- |
| Create realtime meeting | `POST /meetings` with `source_type: realtime` | Primary CTA creates a realtime meeting and opens its detail/recording view. |
| Create upload meeting | `POST /meetings` with `source_type: upload` | Secondary CTA creates an upload meeting and opens the upload view. |
| Realtime pause/resume/stop | WebSocket `recording.pause`, `recording.resume`, `recording.stop` | Recording panel exposes stateful start/pause/resume/stop controls and a session timer. |
| Upload processing state | `POST /meetings/{id}/media` returns `JobResponse`; `GET /jobs/{id}` is authoritative | Upload page polls the job and only opens transcript after `completed`; failure is explicit and retryable. |
| Edit transcript timing | `PATCH /segments/{logical_segment_id}` accepts `text`, `start_ms`, `end_ms` | Segment editor validates and saves content and timestamps. |
| Assign segment speaker | `PATCH /segments/{logical_segment_id}/speaker` returns `TranscriptMutationResponse` | Segment editor provides a speaker selector and reloads the current immutable version. |
| Merge segments | `POST /segments/merge` | UI allows selecting two adjacent segments, then delegates merge to backend. |
| Delete segment confirmation | `DELETE /segments/{logical_segment_id}` | A confirmation dialog is required before invoking delete. |

## APIs now integrated in frontend

- Create/update speakers: `POST /meetings/{id}/speakers`, `PATCH /speakers/{id}`.
- Translation/summary creation and result reads.
- Export creation/download and member-based collaboration.
- Meeting/media deletion and share-link management.

## Current gap status

| BA requirement | Gap | Required contract decision |
| --- | --- | --- |
| Audio playback and per-segment replay | Implemented: playback-url, local ticket/Range proxy, S3 signed URL and segment-synced player. | Browser expiry/seek QA remains; media download handler has an undeclared `request` reference. |
| Login by phone | Auth request currently accepts email/password. | Confirm phone login is MVP; if yes, define normalized phone identifier, uniqueness and recovery rules. |
| Registration fields | Current auth contract covers email, password and full name only. | Confirm whether phone, organization, password confirmation and consent must be persisted or remain UI validation only. |
| Realtime reconnect policy | New upstream stream and speaker-label scope per connection; final timestamps continue from saved duration. | Generic identity is not resumed; validate reconnect UX and latency in browser. |
| Upload retry | Upload retry currently uploads the selected file again. | Decide whether failed jobs can be retried server-side without a new upload. |
| Delete/retention policy | Delete APIs exist, but UI retention metadata and audio-only policy are not exposed. | Define retention dates, what survives audio deletion, and user-facing deletion confirmations. |

## Phase 1 acceptance checks

1. Realtime creation sends `source_type=realtime` and opens `/meetings/:id`.
2. Upload creation sends `source_type=upload` and opens `/meetings/:id/upload`.
3. Upload remains on its page while a job is queued/processing; it opens the meeting only after `completed`.
4. Permission denial, socket/provider failure and job failure are shown as errors, never as success.
5. A transcript edit rejects an empty body or `end_ms <= start_ms` before sending it.
6. Merge only permits adjacent segments.
7. Delete needs explicit confirmation and creates a new transcript version only after confirmation.
