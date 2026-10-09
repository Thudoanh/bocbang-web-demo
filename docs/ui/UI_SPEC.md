# Bóc Băng AI — UI Specification

> Đây là yêu cầu giao diện tham chiếu BA, không phải danh sách chức năng đã
> kiểm thử. Trạng thái implementation cập nhật ngày 2026-10-08 nằm trong
> [frontend README](../../frontend/README.md) và
> [Current Status](../../project_context/CURRENT_STATUS.md).

## 1. Purpose and authority

This specification is extracted from `BocBang_AI_BA.docx` (Draft 1.0, updated 28/09/2026) and is intended for frontend implementation.

**Visual source of truth:** `docs/ui/references/`.

**Priority when sources conflict:**
1. BA-derived reference images in `docs/ui/references/`
2. This specification and `SCREEN_SPEC.md`
3. Existing production frontend behavior and supported data
4. `prototype/` only as a secondary implementation reference

Do not redesign the product. Do not copy mock data or fake behavior from the BA images. Preserve real routes, API integration, authentication, state management, permissions, and backend contracts.

## 2. Product visual language

The BA depicts a restrained enterprise web application for meeting transcription and document processing.

### 2.1 Overall appearance
- Light gray/blue-neutral application background.
- White primary content surfaces and panels.
- Dark navy is the primary action and navigation color.
- Muted blue-gray text for secondary information and metadata.
- Thin, low-contrast borders around cards, form fields, panels, and sidebar sections.
- Shadows are minimal or absent; separation is primarily achieved with borders and background contrast.
- Corner radii are small to medium, not pill-heavy.
- Information density is moderate: compact enough for productivity use but with clear section spacing.
- Decorative gradients, glassmorphism, large hero blocks, oversized typography, and ornamental cards are not part of the BA visual language.

### 2.2 Implementation token guidance
The BA does not define exact CSS values. The following are implementation approximations inferred from the screenshots and should be tuned against the reference images rather than treated as contractual values.

```css
:root {
  --color-bg: #f4f7fb;
  --color-surface: #ffffff;
  --color-primary: #0b1733;
  --color-primary-hover: #152442;
  --color-text: #101828;
  --color-text-secondary: #667085;
  --color-text-muted: #98a2b3;
  --color-border: #dfe5ee;
  --color-border-soft: #e9edf3;
  --color-success-bg: #ecfdf3;
  --color-success-text: #027a48;
  --color-danger-bg: #fff1f0;
  --color-danger-text: #b42318;
  --color-info-bg: #eef6ff;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Use a single consistent font stack across the application. Exact font family is not specified by the BA; prioritize a clean sans-serif with high Vietnamese legibility.

## 3. Application shell

Authenticated screens use a persistent left sidebar and a main workspace.

### 3.1 Sidebar
Reference: `references/01-sidebar.png`.

The sidebar contains, top to bottom:
- Bóc Băng AI brand mark and product label.
- Primary action: **Tạo phiên họp mới**.
- Secondary action: **Tải lên bản ghi**.
- Search field for recordings/meetings.
- **Danh mục cuộc họp** with recent meetings and duration metadata.
- **Công cụ & Quản lý** navigation group.
- User identity/profile block pinned near the bottom.

Navigation items shown in the BA include:
- Danh sách phiên họp
- Tóm tắt AI & Biên bản
- Quản lý người nói
- Dịch thuật song ngữ
- Trạng thái & Ngoại lệ
- Quản lý tệp tải lên
- Lịch sử bản ghi

Behavioral rule: render only routes/features that are actually supported by the production frontend. Do not create fake routes solely because they appear in the visual mockup.

### 3.2 Main workspace
- A slim top bar/breadcrumb area appears above the main content.
- Main page content is aligned to a consistent left edge with stable horizontal padding.
- Most screens use one primary content column, sometimes paired with a right-side contextual panel.
- Page headings follow a consistent hierarchy: eyebrow/section label, page title, secondary description.

### 3.3 Persistent audio/player area
Meeting-related BA screens frequently show a horizontal player area at the bottom. It includes play/pause, current/total time, progress track, playback speed, volume, and a "Nghe lại băng" affordance.

Only render working controls supported by real media data. Do not simulate audio progress or fabricate a media URL.

## 4. Typography hierarchy

Use a restrained hierarchy:
- Page title: strongest weight and largest size on page, but not oversized.
- Section heading: medium emphasis.
- Card/panel title: compact semibold.
- Body: normal weight.
- Metadata/timestamps/helper text: smaller and muted.
- Sidebar section labels: compact uppercase or small-caps-like treatment with muted blue-gray color.

Avoid arbitrary font-size differences between pages.

## 5. Buttons and actions

### Primary button
- Dark navy filled background.
- White text/icon.
- Medium height, modest radius.
- Used for the main action on a screen.

### Secondary button
- White/light background.
- Thin border.
- Dark text.

### Destructive action
- Red text or red-tinted treatment, used sparingly.
- Destructive operations must preserve the BA rule requiring confirmation where data loss may occur.

### Icon buttons
- Minimal chrome.
- Consistent icon size and alignment.

## 6. Forms

- Labels sit above inputs.
- Inputs are white with thin borders and moderate height.
- Two-column form grids are used on wider screens where shown in the BA.
- Helper text is muted and compact.
- Selects visually match text inputs.
- Authentication screens use a centered white card over a pale background.

## 7. Cards, panels, lists, and tables

- White surfaces with thin borders.
- Avoid heavy shadows.
- Header/body separation should be subtle.
- Meeting/history rows prioritize title, date/time/speaker metadata, state, and a right-aligned action.
- Transcript rows are stacked vertically, with speaker identity/timestamp separated from transcript text.
- Right-side panels are used for contextual meeting information, quick summary, speaker distribution, process guidance, or account actions where shown.

## 8. Status and feedback

Use compact badges/tags for job or processing state. Styling must be consistent across the application.

Core BA states are defined in `STATE_SPEC.md`.

Feedback patterns:
- Loading/processing: visible progress or state text.
- Completed: positive but restrained success treatment.
- Failed: clear error state and retry when supported.
- External AI/API failure must never be displayed as success.

## 9. Responsive behavior

The BA primarily illustrates desktop layouts. Implement responsive degradation without changing the information hierarchy:
- Sidebar may collapse into a drawer on narrow screens.
- Two-column layouts stack vertically.
- Wide transcript/translation layouts may become stacked sections.
- Actions may wrap but should preserve primary/secondary priority.
- Keep form fields usable and avoid horizontal overflow.

Do not invent a visually unrelated mobile design.

## 10. Implementation constraints for the coding agent

- Keep `prototype/` unchanged and treat it as secondary reference only.
- Preserve all existing production functionality.
- Prefer shared components and centralized design tokens over page-specific one-off CSS.
- Reuse the existing frontend architecture; do not replace the app with static prototype HTML.
- Do not create fake account data, transcript content, meetings, summary content, audio URLs, or processing results.
- If a BA visual element has no supported backend data, omit/disable it honestly rather than simulating it.
- When the BA reference conflicts with prototype styling, follow the BA reference.
