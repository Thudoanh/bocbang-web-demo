import assert from "node:assert/strict";
import test from "node:test";
import { finishLiveTranscript, updateLiveTranscript } from "../src/realtime/liveTranscript.ts";
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
