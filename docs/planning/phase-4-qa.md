# Phase 4 — UI polish and acceptance QA

Updated: 2026-10-01. This checklist records static/UI build verification, not
provider-backed browser E2E results.

## Completed polish

- Replaced shell/auth Unicode navigation glyphs with a shared inline-SVG icon
  primitive (`Icon`), retaining text labels and accessible names.
- Normalized icon sizing in sidebar, header, primary actions and auth brand.
- Kept semantic button labels; decorative icons are hidden from screen readers.
- Verified responsive CSS coverage for sidebar collapse, grids, history filters,
  translation pair stacking, forms, dialogs and export cards.

## Reference comparison checklist

| Area | Reference | Result |
| --- | --- | --- |
| Auth shell | `02-login.png`, `03-register.png`, `04-forgot-password.png` | Centered pale-shell card, navy brand/action and restrained field layout are implemented. |
| App shell/sidebar | `01-sidebar.png` | Persistent desktop sidebar, actions, recent meetings, tools and profile block are implemented. Supported contextual routes only are shown. |
| Meeting create/realtime/upload | `05-create-meeting.png`, `06-realtime.png`, `07-upload.png` | Form/process panel, recording states and upload job status are implemented from real API state. |
| Transcript/speaker | `08-transcript.png`, `09-speaker.png` | Segment editor, versioning, speaker page and confirmation flow are implemented; playback remains blocked by absent media stream API. |
| Translation/summary/export | `10-translation.png`, `11-summary.png`, `12-export-share.png` | Dedicated desktop layouts use real translation/summary/export contracts and job state. |
| History/settings | `13-history.png`, `14-settings.png` | Server-side search/filter, owner-only deletion/media management and editable display name are implemented. |

## Acceptance verification status

| BA criterion | Status | Evidence / limitation |
| --- | --- | --- |
| Auth and ACL | Code/build verified | Requires configured auth database for E2E. |
| Realtime start/pause/resume/stop | Code/build verified | Requires streaming STT provider + browser microphone permission. |
| Upload progress and completed transcript | Code/build verified | Requires batch STT provider/worker. |
| Transcript edit/speaker management | Code/build verified | REST contracts and permission gates are in frontend/backend. |
| Translation/summary/export | Code/build verified | Requires configured providers; jobs do not report success before terminal state. |
| History/delete policy | Code/build verified | Owner-only controls and confirmation dialogs are implemented. |
| Playback and public shared content | Blocked | Backend lacks media stream endpoint and token-scoped content read endpoints. |

## Required external QA pass

1. Start FastAPI with PostgreSQL, storage, FFmpeg and at least one real STT
   provider configured; sign in with owner/read/comment/edit users.
2. Check desktop at the BA reference viewport and narrow/mobile layout.
3. Exercise microphone denied, socket/provider failure, upload failure,
   immutable edit, delete cancel/confirm and share expiry/revocation.
4. Record screenshots plus API request outcomes; do not mark provider workflows
   accepted from a frontend build alone.
