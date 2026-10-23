import assert from "node:assert/strict";
import test from "node:test";
import { isPolishPending, isPolishStale, polishToolState, type PolishContext } from "../src/utils/transcriptPolish.ts";
import type { TranscriptPolish } from "../src/types/domain.ts";

const context = { meeting: { status: "completed", permission: "owner" }, hasTranscript: true, versionId: "v1", available: true } as PolishContext;
const proposal = { job: { id: "job-1", status: "completed" }, source_version_id: "v1", revision: 1, segments: [] } as TranscriptPolish;

test("loading and unavailable metadata are not presented as ready", () => {
  assert.equal(polishToolState().disabled, true);
  assert.equal(polishToolState(undefined, undefined, "Lỗi mạng").disabled, false);
  assert.equal(polishToolState(undefined, undefined, "Lỗi mạng").tone, "error");
});

test("every unfinished meeting locks polishing with a clear reason", () => {
  for (const status of ["created", "recording", "processing", "failed"] as const) {
    const state = polishToolState({ ...context, meeting: { ...context.meeting, status } }, proposal);
    assert.equal(state.disabled, true);
    assert.match(state.reason, /Kết thúc cuộc họp/);
  }
});

test("completed meeting without transcript cannot start polishing", () => {
  const state = polishToolState({ ...context, hasTranscript: false });
  assert.equal(state.disabled, true);
  assert.match(state.reason, /Chưa có transcript/);
});

test("queued, processing and retrying jobs remain visibly pending", () => {
  for (const status of ["queued", "processing", "retrying"] as const) {
    const value = { ...proposal, job: { ...proposal.job, status } };
    assert.equal(isPolishPending(value), true);
    assert.equal(polishToolState(context, value).label, "Đang xử lý");
    assert.equal(polishToolState(context, value).disabled, false);
  }
});

test("completed proposal waits for explicit user review, never counts as accepted", () => {
  assert.equal(isPolishPending(proposal), false);
  assert.equal(polishToolState(context, proposal).label, "Chờ duyệt");
  assert.equal(polishToolState(context, proposal).tone, "review");
});

test("accepted status comes only from the server accepted-version pointer", () => {
  const value = { ...proposal, accepted_version_id: "v2" };
  assert.equal(polishToolState({ ...context, versionId: "v2" }, value).label, "Đã chốt");
  assert.equal(isPolishStale(value, "v2"), false);
});

test("edits after processing or acceptance require a fresh proposal", () => {
  assert.equal(isPolishStale(proposal, "changed"), true);
  assert.equal(polishToolState({ ...context, versionId: "changed" }, proposal).label, "Cần làm lại");
  assert.equal(polishToolState({ ...context, versionId: "changed" }, { ...proposal, accepted_version_id: "v2" }).label, "Cần làm lại");
});

test("provider failures and read failures stay actionable", () => {
  const failed = { ...proposal, job: { ...proposal.job, status: "failed" as const } };
  assert.equal(polishToolState(context, failed).label, "Có lỗi");
  assert.equal(polishToolState(context, failed).disabled, false);
  assert.equal(polishToolState(context, proposal, "Lỗi mạng").tone, "error");
});

test("AI disabled blocks new generation, not access to an existing review", () => {
  const disabled = { ...context, available: false };
  assert.equal(polishToolState(disabled).disabled, true);
  assert.equal(polishToolState(disabled, proposal).disabled, false);
});

test("read and comment users may view results but cannot request missing ones", () => {
  for (const permission of ["read", "comment"] as const) {
    const read = { ...context, meeting: { ...context.meeting, permission } };
    assert.equal(polishToolState(read).disabled, true);
    assert.equal(polishToolState(read, proposal).disabled, false);
  }
  assert.equal(polishToolState(context).disabled, false);
});
