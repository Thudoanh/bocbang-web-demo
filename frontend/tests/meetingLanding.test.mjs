import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let MeetingsPage;
let ThemeToggle;
let ThemeProvider;

before(async () => {
  // Transform TSX using the app's own Vite setup; no browser, server listen or API calls.
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  ({ MeetingsPage } = await server.ssrLoadModule("/src/pages/MeetingsPage.tsx"));
  ({ ThemeToggle } = await server.ssrLoadModule("/src/components/ThemeToggle.tsx"));
  ({ ThemeProvider } = await server.ssrLoadModule("/src/theme/ThemeContext.tsx"));
});

after(async () => { await server?.close(); });

test("landing renders one name-submit form, with no duplicate history or launch buttons", () => {
  const html = renderToStaticMarkup(createElement(MeetingsPage, { createOnly: true }));
  assert.match(html, /Tạo cuộc họp mới/);
  assert.match(html, /type="submit"/);
  assert.match(html, /maxLength="255"/i);
  assert.match(html, /<details[^>]*><summary>Tùy chọn cuộc họp/);
  assert.match(html, /Nhấn Enter/);
  assert.doesNotMatch(html, /history-tools|meeting-list|Ghi âm mới|Tải file lên|onboarding-actions/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  // Until a nonblank name is entered, the only submit action must be disabled.
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
});

test("upload launch uses source-specific guidance and a single submit action", () => {
  const html = renderToStaticMarkup(createElement(MeetingsPage, { createOnly: true, initialSource: "upload" }));
  assert.match(html, /Tải bản ghi cuộc họp/);
  assert.match(html, /tiếp tục tải bản ghi/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Ghi âm mới|onboarding-actions/);
});

test("separate management screen retains filters without creation launch actions", () => {
  const html = renderToStaticMarkup(createElement(MeetingsPage));
  assert.match(html, /Quản lý cuộc họp/);
  assert.match(html, /history-tools/);
  assert.doesNotMatch(html, /Ghi âm mới|Tải file lên|onboarding-actions/);
});

test("settings theme control has a visible label for either current theme", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    for (const [theme, next] of [["light", "tối"], ["dark", "sáng"]]) {
      // ThemeProvider reads the boot-applied document theme at initialization.
      Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: { theme } } } });
      const html = renderToStaticMarkup(createElement(ThemeProvider, null, createElement(ThemeToggle, { showLabel: true })));
      assert.ok(html.includes(`<span>Chuyển sang chế độ ${next}</span>`));
      assert.match(html, /theme-toggle-labeled/);
      assert.ok(html.includes(`aria-pressed="${theme === "dark"}"`));
      assert.doesNotMatch(html, /shell-theme-toggle/);
    }
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
});
