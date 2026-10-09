import assert from "node:assert/strict";
import test from "node:test";
import { updateLiveTranscript } from "../src/realtime/liveTranscript.ts";
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
