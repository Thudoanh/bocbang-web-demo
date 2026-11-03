import assert from "node:assert/strict";
import test from "node:test";
import { nextBrowserRecovery, browserRecoveryKey, type LiveTranscriptEntry } from "../src/realtime/liveTranscript.ts";
import { BrowserRecoveryScheduler } from "../src/realtime/browserRecovery.ts";

const draft = (extra: Partial<LiveTranscriptEntry> = {}): LiveTranscriptEntry => ({
  type: "transcript.partial", language: "vi", text: "đừng", start_ms: 108000, end_ms: 108700,
  stream_segment_id: "session:turn:9", revision: 3, draft_saved_revision: 3,
  draft_saved_at: "2026-11-03T00:00:00Z", recognition_status: "unconfirmed", ...extra,
});

test("an archived saved word is automatically selected even after later confirmed text", () => {
  const event = draft();
  const state = {
    "final:other": { ...event, type: "transcript.final" as const, stream_segment_id: "session:turn:8", logical_segment_id: "other" },
    pending: event,
  };
  const [key, selected] = nextBrowserRecovery(state, new Map())!;
  assert.equal(key, "pending");
  assert.equal(selected.text, "đừng");
});

test("active hypotheses, unacknowledged words and native finals awaiting persistence are not auto-committed", () => {
  for (const event of [
    draft({ recognition_status: undefined }), draft({ awaiting_final: true }),
    draft({ draft_saved_revision: 2 }), draft({ revision: undefined }), draft({ text: "" }),
    draft({ type: "transcript.final", logical_segment_id: "stored" }),
  ]) assert.equal(nextBrowserRecovery({ pending: event }, new Map()), undefined);
});

test("retries are bounded per revision and another interrupted turn can continue", () => {
  const first = draft();
  const second = draft({ stream_segment_id: "session:turn:10", start_ms: 109000, end_ms: 110000 });
  const attempts = new Map([[browserRecoveryKey(first), 3]]);
  assert.equal(nextBrowserRecovery({ first, second }, attempts)?.[0], "second");
  attempts.set(browserRecoveryKey(second), 3);
  assert.equal(nextBrowserRecovery({ first, second }, attempts), undefined);
});

test("ongoing speech cannot postpone recovery of an older archived word forever", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const scheduler = new BrowserRecoveryScheduler();
  let calls = 0;
  const run = () => { calls++; };
  scheduler.schedule("old-turn", 2000, run);
  for (let i = 0; i < 19; i++) {
    context.mock.timers.tick(100);
    scheduler.schedule("old-turn", 2000, run);
  }
  assert.equal(calls, 0);
  context.mock.timers.tick(100);
  assert.equal(calls, 1);
  scheduler.cancel();
});

test("a native final or navigation can cancel an unstarted recovery", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const scheduler = new BrowserRecoveryScheduler();
  let calls = 0;
  scheduler.schedule("old-turn", 2000, () => { calls++; });
  scheduler.cancel();
  context.mock.timers.tick(3000);
  assert.equal(calls, 0);
});
