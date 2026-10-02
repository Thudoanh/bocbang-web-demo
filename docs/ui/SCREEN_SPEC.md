# Bóc Băng AI — Screen Specification

This document maps the BA UI into implementable frontend screens. Reference images are extracted directly from the BA document.

## 01. Sidebar / authenticated navigation
**Reference:** `references/01-sidebar.png`

### Required structure
- Brand area: Bóc Băng AI + product subtitle/version treatment.
- Primary CTA: Tạo phiên họp mới.
- Secondary CTA: Tải lên bản ghi.
- Search input.
- Recent meeting list with title and duration.
- Tool/management navigation group.
- User identity block at bottom.

### Notes
Sidebar is the primary access point to meetings, upload, processing tools, and profile-related functions.

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
- Breadcrumb/back context.
- Eyebrow: Tạo phiên họp.
- Title: Cuộc họp mới.
- Main form card on the left.
- Process guidance panel on the right.
- Form fields shown by BA: meeting name, description, recognition language, speaker mode.
- Footer actions: cancel and primary action to continue to recording.

### Business behavior
Successful creation creates a Meeting and leads to realtime recording.

---

## 06. Realtime transcription
**Reference:** `references/06-realtime.png`

### Required structure
- AppShell.
- Meeting title and realtime context.
- Recording/connection state indicator and timer.
- Controls for pause/resume and end recording when supported.
- Realtime transcript list grouped by speaker and timestamp.
- Current/partial segment visually distinguishable from finalized segments.
- Optional segment actions only when supported.
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
- Top-level actions such as export/share/summary when actually supported.
- Audio visualization/player area when a real media URL is available.
- Transcript segments stacked vertically.
- Each segment shows speaker, timestamp, text, and optional play-segment action.
- Right-side contextual panel for meeting information and quick summary/next action where supported.

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
- Top actions: regenerate, export, copy when supported.
- Main summary content divided into numbered/labelled sections.
- Possible sections: overall summary, key points, decisions, action items, risks/notes.
- Right-side panel for speaker distribution and template/context information where data exists.

### Business behavior
- Summary requires a valid transcript.
- BA supports general, briefing, voting, or configured templates.
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
