# Bóc Băng AI — Shared Component Specification

> Đây là yêu cầu giao diện tham chiếu BA, không phải danh sách chức năng đã
> kiểm thử. Trạng thái implementation cập nhật ngày 2026-10-08 nằm trong
> [frontend README](../../frontend/README.md) và
> [Current Status](../../project_context/CURRENT_STATUS.md).

This file defines reusable UI primitives derived from the BA screenshots. Names are implementation suggestions; adapt them to the existing frontend architecture.

## 1. `AppShell`
**Purpose:** authenticated application frame.

### Contains
- `Sidebar`
- top bar / breadcrumb context
- main content viewport
- optional persistent `AudioPlayer`

### Rules
- Stable sidebar width on desktop.
- Main content uses consistent padding and background.
- Do not duplicate shell markup inside individual pages.

## 2. `Sidebar`
**Reference:** `references/01-sidebar.png`

### Subcomponents
- `BrandBlock`
- `PrimarySidebarAction`
- `SidebarSearch`
- `RecentMeetingList`
- `SidebarNavGroup`
- `SidebarNavItem`
- `UserProfileCompact`

### States
- default
- hover
- active/current route
- disabled only when feature truly unavailable

## 3. `PageHeader`
### Props/concepts
- eyebrow/section label
- title
- description
- breadcrumb/back affordance
- right-aligned action group

Use consistent spacing across pages.

## 4. `Button`
### Variants
- `primary`: dark navy fill, white text
- `secondary`: white/light surface, border, dark text
- `ghost`: low-chrome action
- `danger`: destructive semantic styling
- `icon`: compact icon-only action

### Sizes
Prefer a small set such as `sm`, `md`, `lg`; do not create page-specific button heights.

## 5. `Input`, `Textarea`, `Select`, `Checkbox`
### Rules
- Label above control.
- Consistent control height and border.
- Visible focus state.
- Error/helper text below control.
- Disabled controls remain readable.

## 6. `Panel` / `Card`
### Rules
- White surface.
- Thin border.
- Minimal/no shadow.
- Small/medium radius.
- Optional header, body, footer regions.

Avoid a card around every small piece of content; BA uses panels to group meaningful sections.

## 7. `StatusBadge`
Used for job/meeting state.

### Semantic variants
- neutral / created
- recording / active
- processing
- completed / success
- failed / danger

Status text must come from real application state, not the mockup.

## 8. `MeetingListItem`
### Content
- meeting title
- date/time or duration metadata
- optional speaker count
- status badge
- open/action button
- optional overflow actions

Used in recent lists/history/upload results where appropriate.

## 9. `UploadDropzone`
### Content
- upload icon
- drag/drop instruction
- accepted-type helper text where known
- file picker button

### States
- idle
- drag-over
- validating
- uploading
- validation error

## 10. `JobProgressRow`
### Content
- filename/title
- media metadata
- progress bar when measurable
- current job state
- retry/open action when valid

Do not show artificial numeric progress if backend only exposes state.

## 11. `TranscriptSegment`
### Content
- speaker identity/avatar/initials
- speaker name
- timestamp range
- transcript text
- optional confidence metadata
- optional segment action(s)

### States
- final/read-only
- partial/current realtime
- playing/active
- editing
- error/unsaved if applicable

## 12. `TranscriptEditor`
May wrap or extend `TranscriptSegment`.

### Supported BA actions
- edit text
- edit timing
- change speaker
- split
- merge
- delete
- save

Only expose actions backed by production API behavior.

## 13. `AudioPlayer`
### BA visual elements
- play/pause
- current / total duration
- progress track
- playback speed
- volume
- replay/listen label

### Rule
Render only with a real media source. If media was removed by retention policy, replace player with a clear unavailable state.

## 14. `SpeakerCard`
### Content
- avatar/initials
- name
- role/title/organization where available
- segment count
- speaking duration
- verified/assigned state when meaningful
- listen sample/edit actions

## 15. `TranslationSegmentPair`
### Desktop layout
Two aligned columns:
- original segment
- translated segment

Preserve speaker/timestamp context.

### Narrow layout
Stack original then translation while preserving segment association.

## 16. `SummarySection`
### Content
- section index/label
- title
- prose or list content

Use the same component for overview, key points, decisions, action items, and risks/notes.

## 17. `ExportFormatCard`
### Content
- format icon
- format name
- short description
- selected state

Expose only formats actually implemented.

## 18. `SharePanel`
### Content
- permission selector
- generated share link
- copy/open action
- explanatory privacy/access note

Permission options must match backend enforcement.

## 19. `EmptyState`
Compact, functional presentation for screens with no meetings/transcript/speakers/history. Avoid large decorative illustrations not shown in BA.

## 20. `ErrorNotice` / `InfoNotice`
Used for external API errors, connection failures, upload validation, and operational information.

External provider failure must be explicit and must never be styled as success.

## 21. `ConfirmDialog`
Required for destructive operations with meaningful data-loss risk, including meeting deletion and segment deletion where applicable.

## 22. Component consistency rules
- All shared colors/spacing/radii/typography come from centralized tokens.
- No page should reimplement its own button, badge, input, or card styling unless there is a documented exceptional need.
- Icon size and text alignment must be consistent.
- Prefer composition over duplicating prototype HTML.
