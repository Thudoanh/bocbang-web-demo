# CRUD/read API performance audit

Audit date: 2026-10-01. Scope excludes STT, translation, summary, and export jobs.

> Historical static audit, not a current benchmark. Subsequent code includes
> transcript projection/edit events/checkpoints, immutable export input reads and
> query indexes. Re-measure current source before treating findings below as
> unresolved. Source reconciliation date: 2026-10-08.

## Measurement status

This is a static code trace, not a production benchmark: no configured database
or representative load was available. The following temporary instrumentation
was added for a measurable next pass:

- `X-Process-Time-Ms` response header on every HTTP response, alongside the
  existing request-completion structured log and request ID.
- `PERFORMANCE_QUERY_TIMING_ENABLED=true` logs `slow_database_query` records;
  `PERFORMANCE_SLOW_QUERY_MS` defaults to `100`. It records only duration,
  operation, and batch status, never SQL text or bound values.
- Disable query timing after collecting a representative browser waterfall.

## Frontend request trace

| Screen/action | Calls | Flow finding |
| --- | --- | --- |
| Login | `POST /auth/login`, then navigation, then `GET /meetings` | Sequential by necessity. Password hashing is intentionally expensive. |
| Meetings / History | `GET /meetings`; create uses `POST /meetings` then navigation | Both lists request every accessible meeting; History filters them in the browser. |
| Meeting detail | meeting, transcript, speakers, and capabilities GETs | These four hooks begin in parallel: good. Comments and transcript versions mount only after the meeting request clears the page-level loading state: avoidable waterfall. |
| Segment mutations | mutation then transcript GET | Current API refetches the whole transcript after each change. |
| Rename speaker / add comment | PATCH or POST then speakers/comments GET | Avoidable reload: mutation response already contains the updated object. |
| 401 recovery | failed request, refresh, retry | Expected flow; concurrent failures can trigger duplicate refreshes. |

## Endpoint findings

| Endpoint(s) | Observed service/DB flow | Bottleneck | Severity | Recommended fix |
| --- | --- | --- | --- | --- |
| `GET /meetings` and History | Auth user lookup + one `Meeting LEFT JOIN MeetingMember` query ordered by timestamps; unbounded response. | `OR` access predicate plus no index beginning `meeting_members.user_id` risks membership scans; JSON and browser filtering scale with total history. | High | Cursor pagination and server-side search/filter. Validate a `UNION ALL` owner/member access plan. Add `meeting_members(user_id, meeting_id)` and consider `meetings(owner_id, updated_at DESC, created_at DESC)`. |
| `GET /meetings/{id}` | Auth lookup, meeting PK lookup, and membership PK lookup for collaborators. | No N+1; two to three small indexed queries. | Low | Keep initially; only combine permission/meeting lookup if timings prove it hot. |
| `GET /meetings/{id}/transcript` | Auth, access, current version, then all ordered segments. | O(segment count) payload on every open and mutation refresh. | High | Add segment pagination/window or range reads; separate/cache compact transcript metadata. Existing `(transcript_version_id, sequence)` index is appropriate. |
| `GET /meetings/{id}/transcript/versions` | Auth, access, transcript lookup, then all versions. | Unbounded history, growing after every user edit. | Medium | Paginate. Existing `(transcript_id, version_no)` unique index supports it. |
| `GET /meetings/{id}/speakers` | Auth, access, speakers by meeting ordered by creation. | No N+1; meeting-only index will sort at scale. | Low | Add `(meeting_id, created_at, id)` only if measurements justify it; update local speaker state after PATCH. |
| `GET /meetings/{id}/comments` | Auth, access, all live comments by meeting ordered by creation. | No N+1, but soft-delete predicate/order are not covered by `comments(meeting_id)`; unpaged. | Medium | Paginate and add PostgreSQL partial index `(meeting_id, created_at) WHERE deleted_at IS NULL`; append POST response locally. |
| Meeting/speaker/comment/member/share writes | Access check, DML, commit, and often `refresh`. | `refresh` adds an extra DB round trip after write. | Medium | Profile then replace safe cases with `flush`/`RETURNING` or loaded state. Verify server-default timestamps and dialect behavior before removal. |
| `PATCH/DELETE/POST /segments/*` | Locate current segment, separately load version/transcript/meeting, load every current segment, create new version, insert a copy of every segment. | One-segment edit is O(N) reads/allocations/inserts; storage grows O(N times edits). `assign_speaker` resolves segment/access before calling mutation, which resolves it again. | Critical | Preserve immutable semantics with deltas/patches, structural sharing, or an edit table. At minimum reuse resolved context and batch inserts. |
| Current-segment lookup | Filter logical ID through current-version joins. Logical IDs repeat in each immutable snapshot. | Standalone logical-ID index increasingly returns historical copies before current-version filter. | High | Capture `EXPLAIN (ANALYZE, BUFFERS)` with edit history; add/validate `segment_versions(logical_segment_id, transcript_version_id)` or a current-segment projection. |
| `POST /auth/login` | Unique user-email lookup then password verify. | Hash verification dominates intentionally; no expected DB scan. | Low | Do not weaken hashing. Measure worker CPU saturation and rate-limit separately. |
| Register/resend/forgot/OTP verify | User lookup and active/latest OTP query; registration/resend awaits email while transaction is open. | Email latency occupies DB connection/transaction; active OTP query/sort has only `email_otps(user_id)` support. | Medium | Commit OTP state before delivery using an outbox/background worker. Add a partial active-OTP index: `(user_id, purpose, created_at DESC) WHERE consumed_at IS NULL`. |
| Protected endpoints generally | Each independent endpoint decodes JWT and loads `User` by PK. | Detail screen creates several identical user lookups in parallel. | Medium | Measure first; consider short-lived verified-user cache or composite screen endpoint without weakening verification/revocation semantics. |

## ORM and query conclusions

Normal list/detail serializers access scalar fields from explicit `select`/`get`
results and do not lazily dereference ORM relationships. There is no conventional
relationship N+1 in the audited normal reads. The repeated work is explicit:
user/access checks on each subrequest and the duplicate segment lookup in
speaker assignment. The material N-times cost is snapshot copying, not lazy
relationship loading.

## Next measurement pass

1. Enable timing in a non-production-like environment with a 1k+ segment transcript and several edits.
2. Run PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` for meeting list, active OTP, comment list, and current-segment lookup.
3. Record p50/p95 and response bytes for transcript reads and segment edits; query time alone misses JSON/network cost.
4. Choose pagination and immutable-history semantics before implementation, as both change API/product behavior.
