import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let MeetingPage;
let MeetingSectionsDialog;
let AppShell;
let TranscriptPolishDialog;
let TranscriptPair;
let TranscriptColumnsHeader;
let RecordingTools;
let ToolbarTooltip;
let sidebarPreference;
let MeetingPlaybackTool;
let playbackUtils;
let PauseRecordingDialog;
let MeetingSocket;
let SessionSelection;
let sectionTimestamp;
let api;
let fixture;
let calls;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    plugins: [{
      name: "workspace-render-fixtures", enforce: "pre",
      load(id) {
        const path = id.replaceAll("\\", "/");
        // Render loaded states without effects, real authentication, network or microphone.
        if (path.endsWith("/src/hooks/useAsync.ts")) return `export function useAsync(fn) {
          return {data:fn(new AbortController().signal),loading:false,reload:async()=>{},setData:()=>{}};
        }`;
        if (path.endsWith("/src/auth/AuthContext.tsx")) return "export function useAuth() {return {accessToken:null};}";
      },
    }],
  });
  api = await server.ssrLoadModule("/src/api/endpoints.ts");
  const result = (name, value) => () => { calls.push(name); return value(); };
  api.meetingsApi.get = result("meeting", () => fixture.meeting);
  api.meetingsApi.fullTranscript = result("transcript", () => fixture.transcript);
  api.meetingsApi.media = result("media", () => fixture.media);
  api.meetingsApi.speakers = result("speakers", () => []);
  api.meetingsApi.sections = result("sections", () => [{ id: "section-1", sequence: 1, title: "Kế hoạch", start_ms: 0, end_ms: null, is_started: false }]);
  api.capabilitiesApi.get = result("capabilities", () => ({ stt: { streaming: true }, translation: { language_pairs: [] } }));
  api.recordingApi.latest = () => fixture.recording ?? { status: "not_completed", media: null, job: null, can_prepare: false, warning: null };
  api.recordingApi.prepare = () => { assert.fail("Rendering must never create a recording job"); };
  for (const name of ["comments", "versions", "addComment", "updateComment", "deleteComment"]) {
    api.meetingsApi[name] = () => { assert.fail(`Removed feature must not call ${name}`); };
  }
  ({ MeetingPage } = await server.ssrLoadModule("/src/pages/MeetingPage.tsx"));
  ({ MeetingSectionsDialog } = await server.ssrLoadModule("/src/components/MeetingSections.tsx"));
  ({ sectionTimestamp } = await server.ssrLoadModule("/src/components/MeetingSections.tsx"));
  ({ SessionSelection } = await server.ssrLoadModule("/src/pages/SummaryPage.tsx"));
  ({ AppShell } = await server.ssrLoadModule("/src/components/AppShell.tsx"));
  ({ TranscriptPolishDialog } = await server.ssrLoadModule("/src/components/TranscriptPolishTool.tsx"));
  ({ TranscriptPair, TranscriptColumnsHeader } = await server.ssrLoadModule("/src/components/TranscriptPair.tsx"));
  ({ RecordingTools } = await server.ssrLoadModule("/src/components/RecordingTools.tsx"));
  ({ ToolbarTooltip } = await server.ssrLoadModule("/src/components/ToolbarTooltip.tsx"));
  sidebarPreference = await server.ssrLoadModule("/src/utils/sidebarPreference.ts");
  ({ MeetingPlaybackTool } = await server.ssrLoadModule("/src/components/MeetingPlaybackTool.tsx"));
  playbackUtils = await server.ssrLoadModule("/src/utils/recordingPlayback.ts");
  ({ PauseRecordingDialog } = await server.ssrLoadModule("/src/components/PauseRecordingDialog.tsx"));
  ({ MeetingSocket } = await server.ssrLoadModule("/src/realtime/meetingSocket.ts"));
});

after(async () => { await server?.close(); });

function render(overrides = {}) {
  fixture = {
    meeting: { id: "meeting-1", title: "Cuộc họp kiểm thử", source_type: "realtime", language_mode: "vi", status: "created", permission: "owner" },
    transcript: { version_id: "internal-version", version_no: 42, segments: [{ logical_segment_id: "segment-1", text: "Nội dung transcript vẫn được hiển thị.", start_ms: 0, end_ms: 1000, speaker_id: null }] },
    media: [],
    ...overrides,
  };
  calls = [];
  const html = renderToStaticMarkup(createElement(MeetingPage, { meetingId: "meeting-1" }));
  assert.deepEqual(calls, ["meeting", "transcript", "media", "speakers", "capabilities"]);
  assert.doesNotMatch(html, /meeting-side|meeting-tabs|role="tablist"|Thông tin phiên họp|Lịch sử chỉnh sửa|Gửi bình luận|>Phiên bản<|>v42</);
  assert.match(html, /Nội dung transcript vẫn được hiển thị/);
  return html;
}

test("realtime workspace keeps recording and editing but no inline session manager or section requests", () => {
  const html = render();
  assert.doesNotMatch(html, /recording-panel|recording-heading|recording-actions|<h2>Ghi âm/);
  assert.match(html, /transcript-section-title/);
  assert.match(html, /transcript-translation-toggle/);
  assert.doesNotMatch(html, /Các phiên trong cuộc họp|Lưu tên|meeting-section-row/);
  assert.match(html, /Đổi tên/);
  assert.match(html, /Chia sẻ/);
  assert.match(html, />Sửa</);
});

test("session manager is a native dialog with names, ranges and edit controls, not a separate page", () => {
  render();
  calls = [];
  const html = renderToStaticMarkup(createElement(MeetingSectionsDialog, { meetingId: "meeting-1", close() {} }));
  assert.deepEqual(calls, ["meeting", "sections"]);
  assert.match(html, /<dialog[^>]*id="meeting-sections-dialog"/);
  assert.match(html, /Các phiên trong cuộc họp/);
  assert.match(html, /không tạm dừng ghi âm/);
  assert.match(html, /Phiên 1 · Kế hoạch/);
  assert.match(html, /Chờ ghi âm/);
  assert.match(html, /Sửa phiên/);
  assert.match(html, /Xóa phiên/);
  assert.match(html, /Thêm phiên tại mốc thời gian/);
  assert.doesNotMatch(html, /href=|recording-panel/);
});

test("read-only session manager exposes names without rename controls", () => {
  render({ meeting: { title: "Chỉ xem", permission: "read", language_mode: "vi", source_type: "upload" } });
  calls = [];
  const html = renderToStaticMarkup(createElement(MeetingSectionsDialog, { meetingId: "meeting-1", close() {} }));
  assert.match(html, /Kế hoạch/);
  assert.doesNotMatch(html, /<input|Lưu tên|<button[^>]*type="submit"/);
});

test("toolbar uses an in-place session button on recording and other meeting tools", () => {
  render();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    for (const pathname of ["/meetings/meeting-1", "/meetings/meeting-1/summary"]) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname } } });
      const html = renderToStaticMarkup(createElement(AppShell, null, createElement("div", null, "workspace")));
      const toolbar = html.match(/<nav class="meeting-tool-nav"[\s\S]*?<\/nav>/)?.[0];
      assert.ok(toolbar);
      assert.match(toolbar, /aria-label="Phiên họp"[^>]*aria-haspopup="dialog"/);
      assert.doesNotMatch(toolbar, /href="[^"]*sections/);
      assert.equal((toolbar.match(/<a /g) ?? []).length, 5);
      assert.equal((toolbar.match(/<button /g) ?? []).length, 3);
      assert.match(toolbar, /Làm mịn/);
      assert.equal((toolbar.match(/role="tooltip"/g) ?? []).length, 8);
      for (const label of ["Bản ghi", "Phiên họp", "Tóm tắt", "Người nói", "Bản dịch", "Xuất"]) assert.ok(toolbar.includes(`aria-label="${label}"`));
      assert.doesNotMatch(toolbar, /<span>Bản ghi<|<span>Phiên họp<|<span>Làm mịn<|<span>Tóm tắt</);
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("session dialog edits grouping metadata without recording/navigation operations", async () => {
  const source = await readFile(new URL("../src/components/MeetingSections.tsx", import.meta.url), "utf8");
  assert.match(source, /showModal\(/);
  assert.match(source, /MEETING_SECTIONS_CHANGED/);
  assert.match(source, /meetingsApi.updateSection/);
  assert.match(source, /meetingsApi.createSection/);
  assert.match(source, /meetingsApi.deleteSection/);
  assert.match(source, /expected_revision/);
  assert.match(source, /Xác nhận xóa phiên/);
  assert.doesNotMatch(source, /recording\.pause|recording\.stop|MicrophonePcmCapture|MeetingSocket|window\.location|window\.confirm/);
  const page = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.match(page, /command\("recording.pause", \{ new_section: newSection, acknowledge: true \}\)/);
  assert.match(page, /Mở “Phiên họp” để đặt tên/);
});

test("summary session selector shows independent checkboxes and select-all controls", () => {
  const sections = [{ id: "one", sequence: 1, title: "Kế hoạch", start_ms: 0, end_ms: 1000 }, { id: "two", sequence: 2, title: "Ngân sách", start_ms: 1000, end_ms: null }];
  const html = renderToStaticMarkup(createElement(SessionSelection, { sections, selected: ["two"], disabled: false, change() {} }));
  assert.match(html, /Chọn phiên cần tóm tắt \(1\/2\)/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.match(html, /Chọn tất cả/);
  assert.match(html, /Bỏ chọn tất cả/);
  const empty = renderToStaticMarkup(createElement(SessionSelection, { sections, selected: [], disabled: true, change() {} }));
  assert.match(empty, /fieldset[^>]*disabled/);
  assert.match(empty, /Chọn ít nhất một phiên/);
});

test("session edit timestamps retain exact millisecond boundaries", () => {
  assert.equal(sectionTimestamp(1001), "00:01.001");
  assert.equal(sectionTimestamp(3600123), "01:00:00.123");
  assert.equal(sectionTimestamp(1000), "00:01");
});

test("summary request sends explicit selected IDs and current revision without filtering old output", async () => {
  const source = await readFile(new URL("../src/pages/SummaryPage.tsx", import.meta.url), "utf8");
  assert.match(source, /section_ids:.*selectedIds/);
  assert.match(source, /sections_revision:/);
  assert.match(source, /!validSelection \|\| generating/);
  assert.match(source, /MEETING_SECTIONS_CHANGED/);
  assert.match(source, /summary.current_version.content.sessions as SessionSummary\[\]\).map/);
  assert.match(source, /Kết quả tóm tắt đã tạo/);
});

test("uploaded workspace retains playback timestamp actions but has no large inline player", () => {
  const html = render({
    meeting: { title: "Bản ghi tải lên", source_type: "upload", language_mode: "vi", status: "processing", permission: "owner" },
    media: [{ id: "media-1", original_filename: "meeting.wav", duration_ms: 1000 }],
  });
  assert.match(html, /aria-label="Nghe từ 00:00"/);
  assert.doesNotMatch(html, /<audio|class="player"/);
  assert.doesNotMatch(html, /recording-panel/);
});

test("completed read-only workspace has no inline polish review or edit controls", () => {
  const html = render({ meeting: { title: "Đã họp", source_type: "realtime", language_mode: "vi", status: "completed", permission: "read" } });
  assert.doesNotMatch(html, /polish-review|Duyệt transcript làm mịn|recording-panel|>Sửa<|>Đổi tên<|>Chia sẻ<|Lưu tên/);
});

function reviewModel(overrides = {}) {
  const noop = () => {};
  return {
    context: { meeting: { status: "completed", permission: "owner" }, hasTranscript: true, versionId: "v1", available: true },
    proposal: { job: { id: "job-1", status: "completed" }, source_version_id: "v1", revision: 3, segments: [{ logical_segment_id: "segment-1", start_ms: 0, end_ms: 1000, original_text: "ban goc", text: "Bản đã làm mịn.", generated_text: "Bản đã làm mịn." }] },
    draft: {}, editing: false, original: true, busy: false, error: "", queryError: "", notice: "", pending: false, accepted: false, stale: false, dirty: false, editable: true,
    tool: { disabled: false, label: "Chờ duyệt", reason: "Chờ duyệt", tone: "review" },
    setDraft: noop, setEditing: noop, setOriginal: noop, generate: noop, save: noop, discard: noop, retry: noop, refresh: noop,
    ...overrides,
  };
}

test("polish dialog retains original comparison, editing, draft save and explicit acceptance", () => {
  render(); calls = [];
  const html = renderToStaticMarkup(createElement(TranscriptPolishDialog, { meetingId: "meeting-1", close() {}, review: reviewModel({ editing: true, dirty: true, draft: { "segment-1": "Nội dung tự sửa." } }) }));
  assert.deepEqual(calls, ["speakers"]);
  assert.match(html, /<dialog[^>]*id="transcript-polish-dialog"/);
  for (const text of ["Duyệt transcript làm mịn", "Bản gốc", "ban goc", "Lưu bản nháp", "Chốt transcript", "Nội dung tự sửa.", "Có sửa đổi chưa lưu"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /href=|recording-panel/);
});

test("polish dialog is read-only when ACL forbids editing", () => {
  render();
  const html = renderToStaticMarkup(createElement(TranscriptPolishDialog, { meetingId: "meeting-1", close() {}, review: reviewModel({ editable: false, original: false }) }));
  assert.match(html, /Bản đã làm mịn/);
  assert.match(html, /Đối chiếu bản gốc/);
  assert.doesNotMatch(html, /Chốt transcript|Lưu bản nháp|Sửa transcript|<textarea/);
});

test("polish dialog shows failed, processing, accepted and stale server outcomes without auto accepting", () => {
  render();
  const base = reviewModel();
  for (const [changes, expected] of [
    [{ pending: true, proposal: { ...base.proposal, job: { id: "job-1", status: "processing" } } }, "Đang làm mịn transcript"],
    [{ proposal: { ...base.proposal, job: { id: "job-1", status: "failed", error: { message: "Provider gặp lỗi" } } } }, "Provider gặp lỗi"],
    [{ accepted: true, proposal: { ...base.proposal, accepted_version_id: "v2" } }, "Transcript đã chốt"],
    [{ stale: true }, "Transcript nguồn đã thay đổi"],
  ]) {
    const html = renderToStaticMarkup(createElement(TranscriptPolishDialog, { meetingId: "meeting-1", close() {}, review: reviewModel(changes) }));
    assert.ok(html.includes(expected));
    assert.doesNotMatch(html, /Chốt transcript/);
  }
});

test("polish tool stays in place; review only mutates via explicit generate/save handlers", async () => {
  const tool = await readFile(new URL("../src/components/TranscriptPolishTool.tsx", import.meta.url), "utf8");
  assert.match(tool, /showModal\(/);
  assert.match(tool, /createPortal/);
  assert.doesNotMatch(tool, /window\.location|recording\.pause|recording\.stop|MicrophonePcmCapture|MeetingSocket|window\.confirm/);
  const source = await readFile(new URL("../src/state/useTranscriptPolish.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!dirtyRef.current\) adopt\(latest\)/);
  assert.match(source, /revision: proposal.revision/);
  assert.match(source, /notifyMeetingTranscriptChanged\(meetingId, true\)/);
  assert.doesNotMatch(source.slice(0, source.indexOf("async function generate")), /transcriptPolishApi\.(create|review)\(/);
});

test("workspace CSS allocates a single full-width track instead of reserving the old side column", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  const layout = css.match(/\.meeting-layout\s*\{([^}]+)\}/)?.[1];
  assert.ok(layout);
  assert.match(layout, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
  assert.doesNotMatch(css, /\.meeting-side\s*\{|\.meeting-tabs\s*\{|\.comments-panel\s*\{/);
});

const pairedText = { text: "Translated text.", sourceLanguage: "vi", targetLanguage: "en" };
function renderPair(props = {}, body = "Nội dung gốc.") {
  return renderToStaticMarkup(createElement(TranscriptPair, { translated: false, speaker: "Nguyễn An", timestamp: "00:01 – 00:04", translation: pairedText, ...props }, createElement("article", { className: "segment", id: "segment-example" }, body)));
}

test("translation hidden renders only the full-width original, even with cached translations", () => {
  const html = renderPair();
  assert.match(html, /Nội dung gốc/);
  assert.doesNotMatch(html, /is-translated|transcript-translation|Translated text/);
  assert.equal(renderToStaticMarkup(createElement(TranscriptColumnsHeader, { translated: false })), "");
});

test("translation enabled renders original left and translated text right with matching metadata", () => {
  const html = renderPair({ translated: true });
  assert.match(html, /transcript-pair is-translated/);
  assert.ok(html.indexOf("Nội dung gốc") < html.indexOf('class="transcript-translation"'));
  assert.match(html, /Nguyễn An/);
  assert.match(html, /00:01 – 00:04/);
  assert.match(html, /lang="en">Translated text/);
  const heading = renderToStaticMarkup(createElement(TranscriptColumnsHeader, { translated: true }));
  assert.match(heading, /<h3>Transcript gốc<\/h3><h3>Bản dịch<\/h3>/);
});

test("missing translations and partial recognition have honest placeholders, never fabricated text", () => {
  const missing = renderPair({ translated: true, translation: undefined });
  assert.match(missing, /Chưa có bản dịch cho đoạn này/);
  assert.doesNotMatch(missing, /Translated text/);
  const partial = renderPair({ translated: true, unconfirmed: true, live: true });
  assert.match(partial, /Lời nói chưa được xác nhận/);
  assert.doesNotMatch(partial, /Translated text|translation-language/);
});

test("VI/EN auto mode keeps the actual target language per row, not one fixed column language", () => {
  const html = renderPair({ translated: true, translation: { text: "Bản dịch tiếng Việt.", sourceLanguage: "en", targetLanguage: "vi" } });
  assert.match(html, /lang="vi">Bản dịch tiếng Việt/);
  assert.match(html, /translation-language">VI/);
  assert.doesNotMatch(html, /Translated text/);
});

test("original editing/playback anchors stay intact in paired layout", () => {
  const body = createElement("form", null, createElement("textarea", { defaultValue: "Đang sửa." }), createElement("button", { type: "submit" }, "Lưu"));
  const html = renderPair({ translated: true }, body);
  assert.match(html, /id="segment-example"/);
  assert.match(html, /<textarea>Đang sửa.<\/textarea>/);
  assert.match(html, /type="submit">Lưu/);
  assert.match(html, /Translated text/);
});

test("paired layout uses equal tracks and shared rows, with no inline translation cards or recording commands", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.transcript-columns-heading, \.transcript-pair\.is-translated\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  const source = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /className="realtime-translation"/);
  assert.match(source, /translation=\{realtimeTranslations\[segment.logical_segment_id\]\}/);
  assert.match(source, /meeting.data.status === "completed" && \(showRealtimeTranslations/);
  const toggle = source.slice(source.indexOf("function toggleTranslation()"), source.indexOf("async function pause("));
  assert.match(toggle, /onTranslationVisibleChange\(false\)/);
  assert.match(toggle, /onTranslationVisibleChange\(true\)/);
  assert.doesNotMatch(toggle, /capture\.|recording\.pause|recording\.stop/);
});

function renderRecording(state = "idle", extra = {}) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(RecordingTools, { state, elapsed: 104, status: "Đang xử lý âm thanh.", fallbackWarning: "", translationStatus: "", onStart: noop, onPause: noop, onResume: noop, onEnd: noop, ...extra }));
}

test("idle recording strip exposes an accessible microphone, permanent clock and ready state", () => {
  const html = renderRecording();
  assert.match(html, /aria-label="Bắt đầu ghi âm"/);
  assert.match(html, /<time[^>]*>00:01:44<\/time>/);
  assert.match(html, /recording-state-label">Sẵn sàng/);
  assert.doesNotMatch(html, /aria-label="Kết thúc cuộc họp"|recording-panel|<h2>/);
  assert.match(html, /role="tooltip"/);
});

test("recording strip has icon-only pause and red end controls, with visible active status", () => {
  const html = renderRecording("recording");
  assert.match(html, /aria-label="Tạm dừng"/);
  assert.match(html, /class="recording-end" aria-label="Kết thúc cuộc họp"/);
  assert.match(html, /recording-state-label">Đang ghi âm/);
  assert.doesNotMatch(html, /<button[^>]*>Tạm dừng|<button[^>]*>Kết thúc/);
});

test("paused recording exposes resume, not a fresh-start or pause button", () => {
  const html = renderRecording("paused");
  assert.match(html, /aria-label="Tiếp tục ghi âm"/);
  assert.match(html, /aria-label="Kết thúc cuộc họp"/);
  assert.match(html, /recording-state-label">Tạm dừng/);
  assert.doesNotMatch(html, /aria-label="Bắt đầu ghi âm"|aria-label="Tạm dừng"/);
});

test("transitional states cannot send duplicate recording commands", () => {
  for (const state of ["connecting", "pausing", "resuming", "stopping"]) {
    const html = renderRecording(state);
    assert.equal((html.match(/<button /g) ?? []).length, 1);
    assert.match(html, /<button[^>]*disabled/);
    assert.doesNotMatch(html, /class="recording-end"/);
  }
});

test("failed recording preserves reconnect and finish choices and readable warning/error details", () => {
  const html = renderRecording("failed", { hasStartedBefore: true, status: "Mất kết nối microphone.", fallbackWarning: "Đang dùng provider dự phòng.", translationStatus: "Dịch realtime: Lỗi dịch." });
  assert.match(html, /aria-label="Kết nối lại ghi âm"/);
  assert.match(html, /aria-label="Kết thúc cuộc họp"/);
  for (const text of ["Mất kết nối microphone.", "Đang dùng provider dự phòng.", "Dịch realtime: Lỗi dịch."]) assert.ok(html.includes(text));
  assert.equal((html.match(/role="alert"/g) ?? []).length, 3);
});

test("finished recording keeps its timer and status without restart controls", () => {
  const html = renderRecording("stopped", { elapsed: 3665 });
  assert.match(html, />01:01:05<\/time>/);
  assert.match(html, /recording-state-label">Đã kết thúc/);
  assert.doesNotMatch(html, /<button /);
});

test("icon tooltips are associated with controls, focusable when disabled and dismissible with Escape", async () => {
  const html = renderToStaticMarkup(createElement(ToolbarTooltip, { label: "Tóm tắt", disabled: true }, createElement("button", { disabled: true, "aria-label": "Tóm tắt" })));
  assert.match(html, /tabIndex="0"/i);
  assert.match(html, /aria-describedby=/);
  assert.match(html, /role="tooltip">Tóm tắt/);
  const source = await readFile(new URL("../src/components/ToolbarTooltip.tsx", import.meta.url), "utf8");
  assert.match(source, /event.key === "Escape"/);
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  assert.match(css, /:is\(:hover, :focus-within\) > \.toolbar-tooltip/);
  assert.match(css, /\.sr-only\s*\{/);
});

test("recording controller stays mounted and only portals presentation; end still requires confirmation", async () => {
  const page = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /className="panel recording-panel"/);
  assert.match(page, /useEffect\(\(\) => \(\) => \{ void pauseForNavigation\(\); \}, \[\]\)/);
  assert.match(page, /recordingHost && createPortal\(<RecordingTools/);
  assert.match(page, /onEnd=\{\(\) => setConfirmingEnd\(true\)\}/);
  assert.match(page, /confirmLabel="Xác nhận kết thúc"/);
  assert.match(page, /close=\{\(\) => setConfirmingEnd\(false\)\}/);
  assert.match(page, /translationHost && createPortal\(<Button/);
  assert.match(page, /<h2>Nội dung<\/h2>\s*<span ref=\{setTranslationHost\}/);
});

test("toolbar reserves its measured height and keeps a stable recording portal host", async () => {
  const shell = await readFile(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<div ref=\{setRecordingHost\} className="recording-toolbar-slot" \/>/);
  assert.match(shell, /MeetingToolbarContext.Provider value=\{recordingHost\}/);
  assert.match(shell, /new ResizeObserver\(measure\)/);
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  assert.match(css, /padding-bottom: calc\(var\(--meeting-toolbar-height/);
  assert.match(css, /width: 44px; height: 44px/);
});

test("compact recording header uses the meeting name once with metadata and ACL actions", () => {
  const html = render();
  assert.match(html, /meeting-compact-header/);
  assert.match(html, /<h1[^>]*>Cuộc họp kiểm thử<\/h1>/);
  assert.match(html, /meeting-compact-meta">Tiếng Việt · Ghi âm/);
  assert.match(html, /meeting-compact-actions/);
  assert.doesNotMatch(html, /kicker|heading-record|<h1>Bản ghi<\/h1>|BẢN GHI/);
  const readOnly = render({ meeting: { title: "Chỉ đọc", source_type: "realtime", language_mode: "en", status: "completed", permission: "read" } });
  assert.match(readOnly, /<h1[^>]*>Chỉ đọc<\/h1>/);
  assert.doesNotMatch(readOnly, />Đổi tên<|>Chia sẻ</);
});

function withLayoutWindow({ collapsed = false, mobile = false, storageBlocked = false } = {}, callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const writes = [];
  const localStorage = {
    getItem(key) { assert.equal(key, sidebarPreference.SIDEBAR_COLLAPSED_KEY); if (storageBlocked) throw new Error("Storage blocked"); return String(collapsed); },
    setItem(key, value) { if (storageBlocked) throw new Error("Storage blocked"); writes.push([key, value]); },
  };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      location: { pathname: "/meetings/meeting-1" }, localStorage,
      matchMedia: () => ({ matches: mobile }),
    } });
    return callback(writes);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}

test("desktop sidebar preference survives reload and blocked storage safely falls back", () => {
  for (const collapsed of [true, false]) withLayoutWindow({ collapsed }, (writes) => {
    assert.equal(sidebarPreference.readSidebarCollapsed(), collapsed);
    sidebarPreference.saveSidebarCollapsed(!collapsed);
    assert.deepEqual(writes, [[sidebarPreference.SIDEBAR_COLLAPSED_KEY, String(!collapsed)]]);
  });
  withLayoutWindow({ storageBlocked: true }, () => {
    assert.equal(sidebarPreference.readSidebarCollapsed(), false);
    assert.doesNotThrow(() => sidebarPreference.saveSidebarCollapsed(true));
  });
});

test("desktop toggle stays outside the hidden sidebar with accurate expanded state", () => {
  render();
  for (const collapsed of [true, false]) withLayoutWindow({ collapsed }, () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement("textarea", { defaultValue: "Nháp vẫn ở đây" })));
    const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0];
    const header = html.match(/<header class="workspace-header"[\s\S]*?<\/header>/)?.[0];
    assert.ok(aside && header);
    assert.doesNotMatch(aside, /sidebar-toggle/);
    assert.match(header, new RegExp(`aria-expanded="${!collapsed}" aria-controls="meeting-sidebar"`));
    assert.ok(header.includes(collapsed ? "Mở thanh bên" : "Thu gọn thanh bên"));
    assert.equal(/<aside[^>]*hidden/.test(aside), collapsed);
    assert.equal(/class="shell [^"]*sidebar-collapsed/.test(html), collapsed);
    assert.match(html, /<textarea>Nháp vẫn ở đây<\/textarea>/);
  });
});

test("mobile drawer starts closed regardless of the saved desktop preference", () => {
  render();
  for (const collapsed of [true, false]) withLayoutWindow({ collapsed, mobile: true }, () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, "workspace"));
    assert.match(html, /<aside[^>]*hidden/);
    assert.match(html, /aria-label="Mở thanh bên" aria-expanded="false"/);
    assert.doesNotMatch(html, /class="sidebar-scrim"|aria-modal="true"|<main inert/);
  });
});

test("sidebar toggling changes layout only, never remounts workspace or recording hosts", async () => {
  const shell = await readFile(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
  const toggle = shell.match(/function toggleSidebar\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(toggle);
  assert.match(toggle, /setSidebarOpen/);
  assert.match(toggle, /setSidebarCollapsed/);
  assert.doesNotMatch(toggle, /recording\.|MeetingSocket|Microphone|window.location|reload\(/);
  assert.match(shell, /<div className="content">\{children\}<\/div>/);
  assert.match(shell, /<div ref=\{setHeaderHost\} className="workspace-header-slot" \/>/);
  assert.match(shell, /<div ref=\{setRecordingHost\} className="recording-toolbar-slot" \/>/);
  assert.doesNotMatch(shell, /key=\{sidebar|sidebarCollapsed\s*\?[^\n]*children/);
  const page = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.match(page, /headerHost \? createPortal\(compactHeader, headerHost\) : compactHeader/);
  assert.doesNotMatch(page, /sidebarCollapsed|sidebarOpen/);
});

test("drawer retains backdrop dismissal, Escape, focus containment and body scroll restoration", async () => {
  const shell = await readFile(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /className="sidebar-scrim"[^>]*onClick=\{\(\) => setSidebarOpen\(false\)\}/);
  assert.match(shell, /event.key === "Escape"/);
  assert.match(shell, /event.key !== "Tab"/);
  assert.match(shell, /document.body.style.overflow = previousOverflow/);
  assert.match(shell, /sidebarTrigger.current\?\.focus\(\)/);
  assert.match(shell, /<main inert=\{sidebarOpen\}>/);
  assert.match(shell, /hidden=\{!sidebarVisible\}/);
  assert.match(shell, /query.addEventListener\("change", change\)/);
  assert.match(shell, /query.removeEventListener\("change", change\)/);
});

test("compact layout reclaims header and sidebar width without losing toolbar clearance", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.shell.sidebar-collapsed\s*\{ --sidebar-width: 0px;/);
  assert.match(css, /\.meeting-sidebar\[hidden\]\s*\{ display: none;/);
  assert.match(css, /\.shell > main\s*\{[^}]*grid-column: 2/);
  assert.match(css, /\.recording-workspace \.content\s*\{ width: 100%; padding-top: 12px;/);
  assert.match(css, /\.recording-workspace \.transcript-section-title\s*\{ margin-top: 0;/);
  assert.match(css, /left: calc\(var\(--sidebar-width\) \+ 24px\)/);
  assert.match(css, /\.meeting-compact-identity h1\s*\{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.meeting-compact-header\s*\{ flex-wrap: wrap;/);
});

test("routine recording messages do not allocate a feedback row, but remain accessible", () => {
  for (const state of ["idle", "recording", "paused", "stopped"]) {
    const html = renderRecording(state, { status: "Thông báo hoạt động bình thường." });
    assert.doesNotMatch(html, /class="recording-feedback"|role="alert"/);
    assert.match(html, /<div class="sr-only" role="status">Thông báo hoạt động bình thường\.<\/div>/);
    assert.match(html, /recording-status-tooltip/);
    assert.match(html, /tabIndex="0" aria-label="Ghi âm:/i);
    assert.match(html, /role="tooltip">Thông báo hoạt động bình thường\./);
    assert.match(html, /<time[^>]*>00:01:44<\/time>/);
  }
});

test("translation success is unobtrusive while translation errors stay visibly readable", () => {
  const success = renderRecording("recording", { translationStatus: "Đã cập nhật bản dịch realtime." });
  assert.doesNotMatch(success, /class="recording-feedback"|role="alert"/);
  assert.match(success, /role="tooltip">[^<]*Đã cập nhật bản dịch realtime\./);
  assert.match(success, /class="sr-only" role="status">[^<]*Đã cập nhật bản dịch realtime\./);
  const error = renderRecording("recording", { translationStatus: "Dịch realtime: Không thể kết nối dịch." });
  assert.match(error, /class="recording-feedback"><p class="recording-error" role="alert">Dịch realtime: Không thể kết nối dịch\.<\/p>/);
  assert.match(error, /aria-label="Tạm dừng"/);
});

test("nonterminal errors and reconnect warnings are never hidden as ordinary status", () => {
  for (const [statusTone, className] of [["error", "recording-error"], ["warning", "recording-warning"]]) {
    const html = renderRecording("recording", { statusTone, status: "Cần kiểm tra kết nối." });
    assert.match(html, new RegExp(`<p class="${className}" role="alert">Cần kiểm tra kết nối\\.<\\/p>`));
    assert.match(html, /aria-label="Tạm dừng"/);
    assert.match(html, /aria-label="Kết thúc cuộc họp"/);
  }
});

test("provider fallback warnings stay visible even without a recording or translation failure", () => {
  const html = renderRecording("recording", { fallbackWarning: "Nhận diện theo tên tạm thời không khả dụng." });
  assert.match(html, /class="recording-feedback"><p class="recording-warning" role="alert">Nhận diện theo tên tạm thời không khả dụng\.<\/p>/);
  assert.equal((html.match(/role="alert"/g) ?? []).length, 1);
});

test("floating tools have individual surfaces, no enclosing panel, and click-through gaps", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/\.meeting-toolbar\s*\{([^}]+)\}/g)].map((match) => match[1]);
  assert.ok(rules.length >= 3);
  assert.match(rules[0], /padding: 0; border: 0; background: transparent/);
  assert.match(rules[0], /box-shadow: none; pointer-events: none/);
  for (const rule of rules) assert.doesNotMatch(rule, /backdrop-filter|var\(--surface\)|padding: (?:8|10)px|border-radius/);
  assert.match(css, /\.toolbar-action\s*\{[^}]*pointer-events: auto/);
  assert.match(css, /\.recording-feedback p\s*\{[^}]*pointer-events: auto/);
  assert.match(css, /\.meeting-tool-nav a, \.meeting-toolbar :where\(\.toolbar-action\) button\s*\{[^}]*background: var\(--surface\)[^}]*box-shadow: var\(--shadow-sm\)/);
  assert.match(css, /\.recording-indicator\s*\{[^}]*min-height: 44px[^}]*background: var\(--surface\)/);
  assert.match(css, /\.meeting-tool-nav\s*\{[^}]*gap: 10px/);
});

test("recording feedback explicitly marks retryable errors and reconnect warnings without changing lifecycle", async () => {
  const page = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.match(page, /setStatus\(event.message \|\| "Lỗi realtime\.", "error"\)/);
  assert.match(page, /setStatus\("Mất kết nối, đang thử kết nối lại…", "warning"\)/);
  assert.match(page, /tone: RecordingStatusTone = "info"/);
  assert.match(page, /statusTone=\{statusTone\}/);
  assert.match(page, /useEffect\(\(\) => \(\) => \{ void pauseForNavigation\(\); \}, \[\]\)/);
  assert.match(page, /onEnd=\{\(\) => setConfirmingEnd\(true\)\}/);
});

test("playback tool reports server readiness honestly without auto assembly or autoplay", () => {
  render();
  for (const status of ["not_completed", "unavailable", "pending", "ready", "failed", "deleted"]) {
    fixture.recording = { status, media: status === "ready" ? { id: "audio-1", original_filename: "meeting.wav" } : null, job: null, can_prepare: status === "failed", warning: null };
    const html = renderToStaticMarkup(createElement(MeetingPlaybackTool, { meetingId: "meeting-1" }));
    assert.match(html, /aria-label="Nghe lại"/);
    assert.equal(/<button[^>]*disabled/.test(html), status === "not_completed");
    assert.equal(/class="playback-pending"/.test(html), status === "pending");
    assert.doesNotMatch(html, /<audio|autoPlay|autoplay|meeting-playback-panel/);
  }
});

test("playback labels and polling distinguish missing audio, pending work and failed jobs", () => {
  const value = (status, can_prepare = false) => ({ status, can_prepare, media: null, job: null, warning: null });
  assert.match(playbackUtils.recordingLabel(value("unavailable")), /Không có âm thanh gốc/);
  assert.match(playbackUtils.recordingLabel(value("unavailable", true)), /Chuẩn bị băng/);
  assert.match(playbackUtils.recordingLabel(value("deleted")), /đã được xóa/);
  assert.match(playbackUtils.recordingLabel(value("failed")), /thất bại/);
  assert.equal(playbackUtils.recordingPollDelay(value("pending")), 2000);
  assert.equal(playbackUtils.recordingPollDelay(value("not_completed")), 10000);
  assert.equal(playbackUtils.recordingPollDelay(value("ready"), true), 5000);
  for (const status of ["ready", "failed", "deleted", "unavailable"]) assert.equal(playbackUtils.recordingPollDelay(value(status)), undefined);
});

test("mini player stays in the toolbar host, supports seek events and leaves capture intact", async () => {
  const tool = await readFile(new URL("../src/components/MeetingPlaybackTool.tsx", import.meta.url), "utf8");
  assert.match(tool, /createPortal\(panel, host\)/);
  assert.match(tool, /hidden=\{!open\}/);
  assert.match(tool, /MEETING_PLAYBACK_SEEK/);
  assert.match(tool, /MEETING_PLAYBACK_TIME/);
  assert.match(tool, /media.id\)\.then/);
  assert.match(tool, /refreshAttempts.current\+\+ < 1/);
  assert.match(tool, /expires.current <= Date.now\(\)/);
  assert.match(tool, /audio.current\?\.pause\(\); playAfterLoad.current = false/);
  assert.match(tool, /trigger.current\?\.focus\(\)/);
  assert.match(tool, /URL.revokeObjectURL/);
  assert.doesNotMatch(tool, /recording\.stop|recording\.pause|MicrophonePcmCapture|MeetingSocket|autoPlay/);
  const page = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.match(page, /seekMeetingPlayback\(meetingId, segment.start_ms\)/);
  assert.match(page, /notifyMeetingPlaybackChanged\(meetingId\)/);
  assert.doesNotMatch(page, /const MediaPlayer =|<MediaPlayer/);
});

test("playback panel has scoped readable controls and reserves measured space without restoring dock frame", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.meeting-playback-panel\s*\{[^}]*order: 0[^}]*pointer-events: auto/);
  assert.match(css, /\.meeting-playback-panel\[hidden\]\s*\{ display: none/);
  assert.match(css, /\.meeting-toolbar :where\(\.toolbar-action\) button/);
  assert.match(css, /\.meeting-playback-panel audio\s*\{ width: 100%/);
  const tool = await readFile(new URL("../src/components/MeetingPlaybackTool.tsx", import.meta.url), "utf8");
  assert.match(tool, /recordingApi.prepare\(meetingId\)/);
  assert.match(tool, /query.data\?\.can_prepare/);
  assert.match(tool, /Không thể tạo lại băng từ transcript/);
  assert.match(tool, /Tải băng xuống/);
  assert.match(tool, /Tốc độ/);
});

test("sidebar search has one outer focus border, not a nested input ring", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.history-search:focus-within\s*\{ border-color: var\(--accent\);/);
  assert.match(css, /\.history-search input, \.history-search input:focus, \.history-search input:focus-visible\s*\{[^}]*border: 0; outline: none; box-shadow: none;/);
  // Other form inputs still retain their normal keyboard/focus styling.
  assert.match(css, /input:focus, textarea:focus, select:focus\s*\{[^}]*box-shadow:/);
  const history = await readFile(new URL("../src/components/MeetingHistory.tsx", import.meta.url), "utf8");
  assert.match(history, /type="search" aria-label="Tìm cuộc họp"/);
});

test("pause dialog offers same-session pause or a new pending section without firing on render", () => {
  const html = renderToStaticMarkup(createElement(PauseRecordingDialog, { choose() { assert.fail("Opening the dialog must not pause or split"); } }));
  assert.match(html, /<dialog[^>]*aria-labelledby=[^>]*aria-describedby=/);
  assert.match(html, />Chỉ tạm dừng<\/button>/);
  assert.match(html, />Tạo phiên mới<\/button>/);
  assert.match(html, /Ghi âm vẫn tiếp tục trong khi chờ lựa chọn/);
  assert.match(html, /chỉ bấm Tiếp tục mới thu lại/);
  assert.match(html, /aria-label="Đóng và chỉ tạm dừng"/);
  assert.doesNotMatch(html, /btn-danger|>Hủy<|window.confirm/);
});

test("pause choice uses a native accessible modal, safe Escape/close and one-shot selection", async () => {
  const source = await readFile(new URL("../src/components/PauseRecordingDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /showModal\(\)/);
  assert.match(source, /onCancel=\{\(event\) => \{ event.preventDefault\(\); select\(false\);/);
  assert.match(source, /if \(settled.current\) return/);
  assert.match(source, /settled.current = true/);
  assert.match(source, /autoFocus onClick=\{\(\) => select\(false\)\}/);
  assert.match(source, /onClick=\{\(\) => select\(true\)\}/);
  assert.match(source, /document.body.style.overflow = previousOverflow/);
  assert.match(source, /previousFocus.focus\(\)/);
  assert.doesNotMatch(source, /MicrophonePcmCapture|MeetingSocket|recording\.stop|recording\.pause/);
});

test("pause button only asks; both choices flush capture and wait for the server before resuming", async () => {
  const page = await readFile(new URL("../src/pages/MeetingPage.tsx", import.meta.url), "utf8");
  assert.match(page, /onPause=\{\(\) => setConfirmingPause\(true\)\}/);
  assert.match(page, /confirmingPause && state === "recording" && <PauseRecordingDialog/);
  assert.match(page, /async function pause\(newSection: boolean\)/);
  assert.match(page, /if \(state !== "recording" \|\| pausing.current\) return/);
  const pause = page.slice(page.indexOf("async function pause(newSection"), page.indexOf("async function resume()"));
  assert.ok(pause.indexOf("await capture.current?.pause()") < pause.indexOf('command("recording.pause"'));
  assert.match(pause, /new_section: newSection, acknowledge: true/);
  assert.doesNotMatch(pause, /setState\("paused"\)|\.resume\(|recording\.stop/);
  assert.match(page, /if \(event.type === "recording.paused"\) \{\s*setState\("paused"\)/);
  assert.match(page, /command\("recording.resume", \{ acknowledge: true \}\)/);
});

test("socket serializes either pause decision and optional ACK without changing navigation pause", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const sent = [];
  let socket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send(payload) { sent.push(JSON.parse(payload)); }
    close() {}
  }
  try {
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeSocket });
    const events = [];
    const client = new MeetingSocket("meeting-1", "fake-token", (event) => events.push(event), () => {});
    client.connect();
    for (const new_section of [false, true]) {
      assert.equal(client.command("recording.pause", { new_section, acknowledge: true }), true);
      assert.deepEqual(sent.at(-1), { type: "recording.pause", new_section, acknowledge: true });
    }
    client.command("recording.resume", { acknowledge: true });
    assert.deepEqual(sent.at(-1), { type: "recording.resume", acknowledge: true });
    client.command("recording.pause");
    assert.deepEqual(sent.at(-1), { type: "recording.pause" });
    socket.onmessage({ data: JSON.stringify({ type: "recording.paused" }) });
    assert.deepEqual(events.at(-1), { type: "recording.paused" });
    socket.readyState = 3;
    assert.equal(client.command("recording.pause", { new_section: true, acknowledge: true }), false);
    assert.equal(sent.length, 4);
  } finally {
    if (previous) Object.defineProperty(globalThis, "WebSocket", previous);
    else delete globalThis.WebSocket;
  }
});
