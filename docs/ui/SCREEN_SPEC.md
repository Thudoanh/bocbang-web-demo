# Bóc Băng AI — Screen Specification

> Đây là yêu cầu giao diện tham chiếu BA, không phải danh sách chức năng đã
> kiểm thử. Trạng thái implementation cập nhật ngày 2026-10-08 nằm trong
> [frontend README](../../frontend/README.md) và
> [Current Status](../../project_context/CURRENT_STATUS.md).

This document maps the BA UI into implementable frontend screens. Reference images are extracted directly from the BA document.

Named sessions: Phiên họp is a bottom-toolbar button opening an in-place native
dialog with editable names/ranges/status, not a separate route or inline panel
above the transcript. Opening/closing/renaming does not pause recording.
Pause first asks whether to create a session. Only an explicit Create new session
choice closes the old session and prepares a pending one, with a short hint
to open the manager (no auto-open); resume ACK starts capture. Summary defaults
to từng phiên, with independently rendered/editable cards and whole-meeting
compatibility selector. See [meeting sessions](../architecture/meeting-sessions.md).

The other choice only pauses within the same session; Close/Escape use this
safe choice. The modal states capture continues until a choice, and focuses
Only pause by default. No pause/split on modal open, no duplicate selection.
Both pause paths and resume wait for server acknowledgement; only Resume
restarts capture. Keep session names/boundaries unchanged on ordinary pause.

Transcript post-meeting review: ending waits for final STT, then the Làm mịn
toolbar button reports durable AI proofreading progress. Open its in-place
dialog for original comparison, text editing,
save draft, and explicit finalize. Current transcript does not change before
finalization; preserve speakers/timestamps/history, show provider errors/retry
and source/draft conflicts. See [review lifecycle](../architecture/transcript-polish.md).

## 01. Sidebar / authenticated navigation
**Reference:** `references/01-sidebar.png`

### Required structure
- Brand area: Bóc Băng AI + product subtitle/version treatment.
- Primary CTA: Tạo phiên họp mới.
- Secondary CTA: Tải lên bản ghi.
- Search input.
- Meeting history grouped by update date, with search, active meeting highlight,
  independent scrolling and load-more pagination from the authenticated API.
- User identity block at bottom.
- Meeting tools (Nghe lại, Bản ghi, Phiên họp, Làm mịn, Tóm tắt, Người nói, Bản dịch, Xuất) in a fixed bottom
  toolbar inside the meeting workspace, with space reserved beneath the content.
- Use separate circular tools with their own solid surfaces, borders and subtle
  shadows, not a shared rounded panel/background/blur. The timer/state is a small
  independent chip to the left. Keep gaps visually clear and click-through;
  only actual tools/status/alert surfaces receive pointer events.
- Mobile history opens as a left drawer; meeting tools remain at the bottom.
- A 44px sidebar toggle stays in the workspace header, outside the sidebar,
  with an accessible name, tooltip and accurate expanded/controls attributes.
  Desktop hides the sidebar fully and remembers its state in browser storage;
  content and bottom toolbar recenter using the reclaimed width. Mobile starts
  closed regardless of the desktop preference, with backdrop/Escape dismissal,
  focus containment/restoration and body-scroll cleanup across breakpoints.
  Visibility changes must not unmount editors, recording or toolbar hosts.
- Voice profiles and settings are accessed from the account menu.

### Notes
Sidebar is the primary access point to meeting history and creation/upload.
Meeting tools belong to the workspace bottom toolbar, not the history sidebar.
Brand links always open the centered new-meeting form at `/meetings` (also `/`).
The meeting overview is a separate management screen at `/history`, accessible
through Xem tất cả. Do not repeat creation/upload launch buttons in the main
home or management content. Theme switching belongs in Settings, not in a
floating authenticated-workspace corner control.

---

## 02. Login
**Reference:** `references/02-login.png`

### Required structure
- Full-page pale background.
- Compact centered authentication card.
- Brand/logo at top of page/card.
- Title: Đăng nhập.
- Account input supporting email/phone according to production behavior.
- Password input.
- Primary login button.
- Link to forgot-password flow.
- Link to account registration.
- Google login may be shown if supported by the current auth implementation.

### Production rule
Do not show an authentication method that is not actually configured or supported.

---

## 03. Register
**Reference:** `references/03-register.png`

### Required structure
- Same authentication shell as Login.
- Title: Tạo tài khoản mới.
- Google registration option when supported.
- BA mockup fields: full name, phone, work email, company/department, password, password confirmation.
- Agreement checkbox where required by product behavior.
- Primary registration action.

### Business requirement
BA requires account registration and may require OTP verification before activation; whether OTP is mandatory remains a BA confirmation point. Implementation must follow the actual backend contract.

---

## 04. Forgot password
**Reference:** `references/04-forgot-password.png`

### Required structure
- Same authentication shell.
- Title: Quên mật khẩu.
- Recovery method selector if actually supported.
- Email/identifier input.
- Primary recovery request action.
- Compact recovery-step explanation.
- Navigation back to login and registration.

### Business flow
Request recovery -> verify OTP/recovery link -> set new password -> return to login.

---

## 05. Create meeting
**Reference:** `references/05-create-meeting.png`

### Required structure
- Authenticated AppShell.
- Centered, spacious title and short guidance: Tạo cuộc họp mới.
- Wide meeting-name field (1–255 characters), with one submit arrow and Enter.
- Description, recognition language and speaker mode under collapsed Tùy chọn cuộc họp.
- No duplicate central history, search/filter bar or recording/upload launch buttons.
- Sidebar upload link selects upload mode with source-specific title, guidance
  and one submit action, leading to file selection after naming.
- Disable duplicate submissions; show actual API errors and retain input for retry.

### Business behavior
Successful creation creates a Meeting and opens the recording workspace (or
upload workspace for upload mode). Do not claim microphone capture has started
merely because the creation form was submitted.

---

## 06. Realtime transcription
**Reference:** `references/06-realtime.png`

### Required structure
- AppShell.
- Meeting title and realtime context.
- Recording/connection state indicator and timer.
- Icon-only start/pause/resume/end controls in the bottom toolbar, not a large
  recording panel above the transcript. End still requires confirmation.
  Keep the timer/state and readable warnings/errors visible in the toolbar.
  Routine messages live in the timer's hover/focus tooltip and accessible live
  region, not a permanent second row. Show error/warning banners only when
  needed: fatal and retryable failures, reconnects, provider fallback and
  translation failures. Never hide retryable errors merely because capture's
  state is still recording. Measure the resulting banner height for clearance.
  Tool names appear on hover/keyboard focus, with accessible names, Escape
  dismissal and at least 44px targets. Presentation portals must not remount
  the recording controller or restart microphone/socket.
- Place the Show/Hide translation button to the right of the Nội dung heading.
- Realtime transcript list grouped by speaker and timestamp.
- Current/partial segment visually distinguishable from finalized segments.
- Optional segment actions only when supported.
- `Gán tên / Lưu giọng` on saved segments: listen to selected intervals, enter
  the person's name and create/add a reusable voice sample. Allow name-only
  confirmation; sample learning requires 10 seconds and runs in the background.
- Player/control area may appear at bottom when meaningful.

### Business behavior
- Request microphone permission.
- Stream audio to Cloud STT.
- Partial transcript is temporary.
- Final transcript is persistable.
- On connection loss, show explicit warning/retry behavior.
- Do not mark the meeting Completed while pending audio is still being processed.

---

## 07. Upload and process file
**Reference:** `references/07-upload.png`

### Required structure
- AppShell.
- Page heading for upload/file processing.
- Drag-and-drop area plus file-picker action.
- Active upload/processing row with filename, metadata, progress bar, and state badge.
- Recently processed list/rows with state and actions such as preview/open when supported.

### Business behavior
- Validate file format, size, duration, and processability.
- Create processing job only for valid media.
- Display processing state and Completed/Failed result.
- Open transcript when processing completes.

---

## 08. Transcript playback and editing
**Reference:** `references/08-transcript.png`

### Playback view structure
- AppShell.
- Meeting title/header.
- Use a slim header beside the sidebar toggle: actual meeting title, small
  language/source metadata and ACL-aware Rename/Share (upload link retained).
  Remove the duplicate BẢN GHI eyebrow and large Bản ghi heading. Long names
  truncate without horizontal overflow; mobile actions can wrap. Render only
  header presentation into a stable shell slot, keeping workspace state intact.
  Transcript fills available width with a small top inset; Nội dung and the
  translation toggle follow immediately, without the old heading spacer.
- Top-level actions such as export/share/summary when actually supported.
- Nghe lại opens a small nonmodal player above the toolbar icons, not a large
  inline panel. Realtime completion prepares a persistent WAV through the worker;
  show real preparing/ready/failure/unavailable/deleted states, with explicit retry
  or old-meeting preparation only when edit ACL/source allow. No autoplay on open.
  Provide play/pause/time/seek, speed and download; closing/Escape pauses and
  restores focus. A transcript timestamp explicitly opens/seeks/plays and time
  events highlight matching segments. Playback URL TTL refresh is bounded.
  Do not reconstruct missing audio from text or revive deleted recordings.
- Transcript segments stacked vertically, full-width when realtime translation
  is hidden. When enabled, split the content into equal original-left and
  translation-right columns, with column headings and matching speaker/timing.
- Align each pair by logical segment ID and shared grid-row height/page scroll,
  not two independent lists that drift when sentence lengths differ. Original
  editing, selection, voice learning and playback anchors remain on the left.
- Show honest placeholders for missing translations/unconfirmed live speech,
  never translate partials speculatively or copy another row's text. Hide removes
  the right column entirely; retained in-memory translations can be shown again
  after end, without creating a saved translation or changing capture lifecycle.
- Each segment shows speaker, timestamp, text, and optional play-segment action.
- Single full-width workspace column for transcript; recording controls and
  mini playback live in the bottom toolbar. No reserved right-hand column.
  The transcript itself uses the conditional 50/50 bilingual layout above.
- Remove the Thông tin / Bình luận / Phiên bản tabs and their user-facing
  features, without replacing them with menus or dialogs. No transcript version
  badge. Do not fetch comments/version lists on the recording page.
- Retain internal transcript revision/history storage and backend APIs; removal
  is not a data purge or change to ACL, summary/export provenance or editing.
- Phiên họp is available from the bottom toolbar on all authenticated meeting
  tool pages. Native modal focus containment, Escape/Close, focus restoration,
  loading/error/retry/empty states, unsaved-name warning and read/edit ACL.
  Keep recording mounted; no route change, capture stop or socket pause on open/save/close.
- Làm mịn opens a native dialog (portal) rather than an inline review panel.
  Show a status marker in its icon button even when closed, with the complete
  processing/review-needed/accepted/error/stale status in its tooltip and accessible
  label; never auto-open/auto-accept. Disabled tools expose their reason through
  a keyboard-focusable tooltip. Keep original comparison,
  draft editing/save, explicit accept, read/edit ACL and source/revision guards.
- Protect unsaved edits on refresh/error/close. Acceptance refreshes the current
  transcript in Bản ghi. Eight meeting-tool icons share a flex-wrapping toolbar
  with recording controls; mobile separates the recording/tool groups into rows.
  Measure the actual toolbar height to reserve transcript clearance, including
  long feedback messages, rather than assuming a fixed number of rows.

### Editing behavior from BA
The BA additionally requires a transcript editing mode with:
- edit segment text;
- edit segment start/end timestamp;
- change speaker;
- split segment;
- merge segment;
- delete segment;
- save changes and update current transcript version.

Editing UI should preserve the same overall AppShell and transcript visual language. Do not fabricate controls if the corresponding operation is unsupported by the current API.

### Playback behavior
Synchronize audio position with active transcript segment when timing/media data exists.

---

## 09. Speaker management
**Reference:** `references/09-speaker.png`

### Required structure
- AppShell.
- Heading: Người nói trong phiên họp / speaker management context.
- Grid/list of speaker cards.
- Card fields may include name, role/title, segment count, speaking duration.
- Actions: listen to voice sample and edit when supported.
- Add speaker action if supported.

### Business behavior
- View detected speakers.
- Add/update speaker information.
- Map auto-detected speaker to participant profile.
- Reassign speaker on segments and synchronize transcript.
- Diarization is not identity confirmation until reviewed by a user.

---

## 10. Bilingual translation
**Reference:** `references/10-translation.png`

### Required structure
- AppShell.
- Heading for bilingual transcript/translation.
- Source/target language context.
- Two-column content area on desktop: original transcript and translated transcript aligned by segment.
- Speaker/timestamp metadata preserved where available.
- Export bilingual content action when supported.

### Business behavior
- Translation requires a valid transcript.
- Translation is stored separately and does not replace the original transcript.
- Initial BA scope guarantees Vietnamese <-> English at the business level.

---

## 11. AI summary / meeting minutes
**Reference:** `references/11-summary.png`

### Required structure
- AppShell.
- Summary page title tied to meeting.
- Two creation modes: built-in template selector, or prompt textarea for a
  user-authored structure; both include an output language selector.
- Top actions: regenerate, copy and edit when supported.
- Main summary content divided into numbered/labelled sections.
- Possible sections: overall summary, key points, decisions, action items, risks/notes.
- Right-side panel for speaker distribution and template/context information where data exists.

### Business behavior
- Summary requires a valid transcript.
- User chooses a built-in general/briefing/voting template or supplies a custom
  prompt; the backend retains accuracy and structured-output constraints.
- Custom output uses one free-form content field for the requested paragraphs,
  headings or lists rather than the fixed five built-in fields. The effective
  prompt is stored with every immutable version.
- Manual edits append a new version; they do not mutate history.
- Regeneration must not silently overwrite history if versioning is implemented.

---

## 12. Export and share
**Reference:** `references/12-export-share.png`

### Required structure
- AppShell.
- Page header tied to the meeting.
- Left panel: export format selection and options.
- Right panel: sharing configuration and share link.
- Clear primary export/share actions.

### Export behavior
BA minimum: PDF and DOCX. Technical design may support PDF, DOCX, TXT, SRT, VTT, JSON. The UI must expose only formats actually implemented.

Optional export controls from BA include speaker names and timestamps.

### Sharing behavior
Use actual permission model. BA describes read/comment/edit sharing levels in the system design. Do not show a permission that backend does not enforce.

---

## 13. History / data management
**Reference:** `references/13-history.png`

This is an explicit management destination at `/history`, not the home opened
by the brand link. Creation/upload launch actions remain in the sidebar.

### Required structure
- AppShell.
- Heading: Lịch sử bản ghi.
- Search and filter controls.
- Meeting/history rows with title, metadata, state, primary open action, and optional overflow menu.
- Status badges are compact and consistent.

### Business behavior
- Search and reopen transcript, summary, translation, or retained audio.
- Audio may be deleted independently if policy permits transcript retention.
- Meeting deletion requires confirmation and cleanup according to system policy.

---

## 14. Profile and settings
**Reference:** `references/14-settings.png`

### Required structure
- AppShell.
- Heading: Hồ sơ cá nhân.
- Main profile card with avatar/initials and editable account/contact fields.
- Secondary account-actions panel.
- Primary update profile action.
- Giao diện group with a labeled light/dark toggle, persisted in the current
  browser; no floating theme control in the authenticated AppShell.

### BA capabilities
- View account/contact information.
- Update permitted personal fields.
- Change password and logout.
- Configure default recognition language and selected transcript/diarization preferences if available.
- Show storage/retention information only if the system implements that capability.

---

## Cross-screen rules
- Use the same AppShell, sidebar, page heading structure, button system, form system, status badges, and spacing scale across screens.
- Use real application data. BA text and person names in screenshots are illustrative only.
- When functionality differs from a BA mockup, preserve production behavior while matching the BA layout and visual language as closely as practical.
