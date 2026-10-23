import assert from "node:assert/strict";
import test from "node:test";
import { route } from "../src/app/route.ts";

test("brand, root and new-meeting links open the creation workspace, not history", () => {
  for (const path of ["/", "/meetings", "/meetings/create"]) {
    assert.deepEqual(route(path), { page: "create" });
  }
});

test("all meetings management is available only at its dedicated history route", () => {
  assert.deepEqual(route("/history"), { page: "history" });
});

test("settings and voice profiles remain accessible through the account menu", () => {
  assert.deepEqual(route("/settings"), { page: "settings" });
  assert.deepEqual(route("/voice-profiles"), { page: "voice-profiles" });
});

test("meeting tools keep their existing deep links", () => {
  assert.deepEqual(route("/meetings/example"), { page: "meeting", id: "example" });
  for (const [suffix, page] of [["summary", "summary"], ["speakers", "speakers"], ["translation", "translation"], ["export-share", "export-share"], ["upload", "upload"]]) {
    assert.deepEqual(route(`/meetings/example/${suffix}`), { page, id: "example" });
  }
});

test("public share and authentication routes are unchanged", () => {
  assert.deepEqual(route("/share/example"), { page: "share", token: "example" });
  for (const [path, mode] of [["/login", "login"], ["/register", "register"], ["/forgot-password", "forgot"]]) {
    assert.deepEqual(route(path), { page: "auth", mode });
  }
});
