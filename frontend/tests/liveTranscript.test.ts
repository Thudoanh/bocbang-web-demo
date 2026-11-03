import assert from "node:assert/strict";
import test from "node:test";
import { browserDraftLabel, interruptBrowserSession, restoreBrowserDrafts, finishLiveTranscript, pruneStalePartials, reconcileStoredTranscript, updateLiveTranscript } from "../src/realtime/liveTranscript.ts";
import type { TranscriptEvent } from "../src/realtime/liveTranscript.ts";

function partial(start: number, end: number, text: string, speaker = "S1"): TranscriptEvent {
  return { type: "transcript.partial", language: "vi", start_ms: start, end_ms: end,
    stream_start_ms: start, stream_end_ms: end, text, speaker_label: speaker,
    stream_segment_id: `${start}:${speaker}` };
}

test("provider corrections replace the interim text instead of appending words", () => {
  let state = updateLiveTranscript({}, partial(0, 500, "Xin cháo"));
  state = updateLiveTranscript(state, partial(0, 1000, "Xin chào mọi người"));
  assert.equal(Object.keys(state).length, 1);
  assert.equal(state["0:S1"].text, "Xin chào mọi người");
});

test("a delayed final does not clear a newer partial", () => {
  let state = updateLiveTranscript({}, partial(0, 800, "Câu trước"));
  state = updateLiveTranscript(state, partial(1100, 1800, "Câu sau đang nói"));
  state = updateLiveTranscript(state, { ...partial(0, 800, "Câu trước."),
    type: "transcript.final", logical_segment_id: "stored-old" });
  assert.equal(state["1100:S1"].text, "Câu sau đang nói");
  assert.equal(state["final:stored-old"].type, "transcript.final");
});

test("merged final replaces covered interim fragments and preserves another speaker", () => {
  let state = updateLiveTranscript({}, partial(0, 500, "Xin"));
  state = updateLiveTranscript(state, partial(550, 1000, "chào"));
  state = updateLiveTranscript(state, partial(550, 1000, "Hello", "S2"));
  state = updateLiveTranscript(state, { ...partial(0, 1000, "Xin chào"),
    type: "transcript.final", logical_segment_id: "stored" });
  assert.deepEqual(Object.keys(state).sort(), ["550:S2", "final:stored"]);
});

test("raw stream times reconcile partials even when final meeting timestamps are offset", () => {
  let state = updateLiveTranscript({}, partial(0, 800, "Xin chào"));
  state = updateLiveTranscript(state, { ...partial(0, 800, "Xin chào."),
    start_ms: 10000, end_ms: 10800, type: "transcript.final", logical_segment_id: "stored" });
  assert.equal(Object.keys(state).length, 1);
  assert.equal(state["final:stored"].type, "transcript.final");
});

test("an old final cannot overwrite an extended partial that shares its stream ID", () => {
  let state = updateLiveTranscript({}, partial(0, 1800, "Câu trước và đang nói tiếp"));
  state = updateLiveTranscript(state, { ...partial(0, 800, "Câu trước"),
    type: "transcript.final", logical_segment_id: "stored-old" });
  assert.equal(state["0:S1"].type, "transcript.partial");
  assert.equal(state["final:stored-old"].type, "transcript.final");
});

test("successive word fragments update a single cumulative turn row", () => {
  let state: ReturnType<typeof updateLiveTranscript> = {};
  for (const event of [partial(0, 300, "Xin"), partial(0, 650, "Xin chào"), partial(0, 1200, "Xin chào mọi người")]) {
    state = updateLiveTranscript(state, { ...event, stream_segment_id: "session:turn:0" });
  }
  assert.deepEqual(Object.keys(state), ["session:turn:0"]);
  assert.equal(state["session:turn:0"].text, "Xin chào mọi người");
});

test("timestamp corrections preserve the row and its final replaces the preview", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 300, "Xin cháo"), stream_segment_id: "session:turn:0" });
  state = updateLiveTranscript(state, { ...partial(40, 700, "Xin chào"), stream_segment_id: "session:turn:0" });
  assert.equal(Object.keys(state).length, 1);
  state = updateLiveTranscript(state, { ...partial(50, 700, "Xin chào."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  assert.deepEqual(Object.keys(state), ["final:stored"]);
});

test("a stale preview cannot recreate a finalized turn row", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 800, "Xin chào."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  state = updateLiveTranscript(state, { ...partial(40, 700, "Xin chào"), stream_segment_id: "session:turn:0" });
  assert.deepEqual(Object.keys(state), ["final:stored"]);
});

test("a final from the previous connection does not clear a new session preview", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 800, "Đang nói"), stream_segment_id: "new:turn:0" });
  state = updateLiveTranscript(state, { ...partial(0, 800, "Câu trước."), stream_segment_id: "old:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  assert.equal(state["new:turn:0"].type, "transcript.partial");
  assert.equal(state["final:stored"].type, "transcript.final");
});

test("overlapping timestamps cannot let an old turn erase a different identified turn", () => {
  let state = updateLiveTranscript({}, { ...partial(500, 800, "Đang nói tiếp"), stream_segment_id: "session:turn:1" });
  state = updateLiveTranscript(state, { ...partial(0, 900, "Câu trước."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  assert.equal(state["session:turn:1"].type, "transcript.partial");
  assert.equal(state["final:stored"].type, "transcript.final");
});

test("an authoritative turn final replaces its preview even when end timing shrinks", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 1200, "Xin chào mọi người"), stream_segment_id: "session:turn:0" });
  state = updateLiveTranscript(state, { ...partial(40, 1100, "Xin chào mọi người."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  assert.deepEqual(Object.keys(state), ["final:stored"]);
  assert.equal(state["final:stored"].text, "Xin chào mọi người.");
});

test("a stale preview with longer timing cannot revive a finalized identified turn", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 1100, "Xin chào."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  state = updateLiveTranscript(state, { ...partial(0, 1200, "Xin chào"), stream_segment_id: "session:turn:0" });
  assert.deepEqual(Object.keys(state), ["final:stored"]);
});

test("recording end retains unresolved text as unconfirmed without changing saved finals", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 800, "Câu đã lưu."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  state = updateLiveTranscript(state, { ...partial(900, 1500, "Bản nháp còn lại"), stream_segment_id: "session:turn:1" });
  const finished = finishLiveTranscript(state);
  assert.equal(finished["session:turn:1"].type, "transcript.partial");
  assert.equal(finished["session:turn:1"].recognition_status, "unconfirmed");
  assert.equal(finished["session:turn:1"].text, "Bản nháp còn lại");
  assert.equal(finished["final:stored"], state["final:stored"]);
  assert.equal(state["session:turn:1"].recognition_status, undefined);
});

test("a delayed authoritative final resolves an unconfirmed row", () => {
  let state = finishLiveTranscript(updateLiveTranscript({}, { ...partial(0, 1200, "Xin chào"), stream_segment_id: "session:turn:0" }));
  state = updateLiveTranscript(state, { ...partial(0, 1000, "Xin chào."), stream_segment_id: "session:turn:0",
    type: "transcript.final", logical_segment_id: "stored" });
  assert.deepEqual(Object.keys(state), ["final:stored"]);
});

test("Browser draft survives the silence timeout; Cloud retains its existing cleanup", () => {
  const state = updateLiveTranscript({}, { ...partial(0, 800, "Xin chào"), stream_segment_id: "session:turn:0" });
  state["session:turn:0"].updated_at = Date.now() - 10000;
  assert.equal(pruneStalePartials(state, 3000, true), state);
  assert.deepEqual(pruneStalePartials(state, 3000), {});
  const finished = finishLiveTranscript(state);
  assert.equal(pruneStalePartials(finished, 3000), finished);
});

test("stored transcript reload uses IDs and does not delete a reconnected stream's draft", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 900, "Bản nháp mới"),
    start_ms: 10000, end_ms: 10900, stream_segment_id: "new:turn:0" });
  state = updateLiveTranscript(state, { ...partial(0, 900, "Đã lưu"),
    type: "transcript.final", logical_segment_id: "stored", stream_segment_id: "old:turn:0" });
  state = reconcileStoredTranscript(state, [{ logical_segment_id: "stored", end_ms: 10000 }]);
  assert.deepEqual(Object.keys(state), ["new:turn:0"]);
  const legacy = { ...partial(0, 900, "Legacy"), start_ms: 10000, end_ms: 10900 };
  assert.equal(Object.keys(reconcileStoredTranscript(updateLiveTranscript({}, legacy), [{ logical_segment_id: "stored", end_ms: 10000 }])).length, 1);
});

test("withdrawal removes only its turn; unconfirmed events keep translations and resolve on final", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 900, "Câu một"), stream_segment_id: "session:turn:0", translation: "First" });
  state = updateLiveTranscript(state, { ...partial(0, 900, "Câu một"), stream_segment_id: "session:turn:0", recognition_status: "unconfirmed" });
  assert.equal(state["session:turn:0"].translation, "First");
  state = updateLiveTranscript(state, { ...partial(1000, 1500, "Câu hai"), stream_segment_id: "session:turn:1" });
  state = updateLiveTranscript(state, { ...partial(1000, 1500, ""), stream_segment_id: "session:turn:1", recognition_status: "withdrawn" });
  assert.deepEqual(Object.keys(state), ["session:turn:0"]);
  state = updateLiveTranscript(state, { ...partial(0, 900, "Câu một."), type: "transcript.final", stream_segment_id: "session:turn:0", logical_segment_id: "stored" });
  assert.deepEqual(Object.keys(state), ["final:stored"]);
});

test("a delayed save acknowledgement cannot replace newer optimistic text", () => {
  const draft = { ...partial(0, 1000, "Chữ mới"), stream_segment_id: "session:turn:0", revision: 3 };
  let state = updateLiveTranscript({}, draft);
  state = updateLiveTranscript(state, { ...draft, text: "Chữ cũ", revision: 2, draft_saved_revision: 2, draft_saved_at: "2026-11-02T00:00:00Z" });
  assert.equal(state["session:turn:0"].text, "Chữ mới");
  assert.equal(state["session:turn:0"].revision, 3);
  assert.equal(browserDraftLabel(state["session:turn:0"]), "Có bản lưu tạm · đang cập nhật");
  state = updateLiveTranscript(state, { ...draft, draft_saved_revision: 3, draft_saved_at: "2026-11-02T00:00:01Z" });
  assert.equal(browserDraftLabel(state["session:turn:0"]), "Đã lưu tạm · đang nhận diện");
});

test("reload restores a saved draft honestly and a final replaces all of its provisional text", () => {
  const draft = { ...partial(0, 1000, "Nháp đã lưu"), stream_segment_id: "session:turn:0", revision: 2,
    draft_saved_revision: 2, draft_saved_at: "2026-11-02T00:00:00Z" } as const;
  let state = restoreBrowserDrafts({}, [draft]);
  assert.equal(state["session:turn:0"].recognition_status, "unconfirmed");
  assert.equal(browserDraftLabel(state["session:turn:0"]), "Nhận diện đã dừng · cần kiểm tra");
  state = updateLiveTranscript(state, { ...draft, type: "transcript.final", logical_segment_id: "stored", revision: 3, text: "Bản cuối sửa cả phần đầu." });
  state = restoreBrowserDrafts(state, [draft]);
  assert.deepEqual(Object.keys(state), ["final:stored"]);
  assert.equal(state["final:stored"].text, "Bản cuối sửa cả phần đầu.");
});

test("a native final waiting for server storage is explicit and stops waiting on interruption", () => {
  const draft = { ...partial(0, 1000, "Bản cuối từ engine"), stream_segment_id: "session:turn:0", revision: 3,
    awaiting_final: true, recognition_status: "unconfirmed" as const };
  let state = updateLiveTranscript({}, draft);
  assert.equal(browserDraftLabel(state["session:turn:0"]), "Đang lưu bản cuối");
  state = updateLiveTranscript(state, { ...draft, text: "Bản nháp cũ", revision: 2, awaiting_final: false, draft_saved_revision: 2, draft_saved_at: "2026-11-02T00:00:00Z" });
  assert.equal(state["session:turn:0"].text, "Bản cuối từ engine");
  assert.equal(browserDraftLabel(state["session:turn:0"]), "Đang lưu bản cuối");
  state = finishLiveTranscript(state);
  assert.equal(browserDraftLabel(state["session:turn:0"]), "Nhận diện đã dừng · cần kiểm tra");
});

test("a spectator interruption archives even unsaved previews only from that socket", () => {
  let state = updateLiveTranscript({}, { ...partial(0, 1000, "Socket cũ"), stream_segment_id: "old:turn:0", revision: 1 });
  state = updateLiveTranscript(state, { ...partial(1000, 2000, "Socket mới"), stream_segment_id: "new:turn:0", revision: 1 });
  state = interruptBrowserSession(state, "old");
  assert.equal(state["old:turn:0"].recognition_status, "unconfirmed");
  assert.equal(state["new:turn:0"].recognition_status, undefined);
});
