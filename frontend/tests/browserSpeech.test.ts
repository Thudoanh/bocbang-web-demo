import assert from "node:assert/strict";
import test from "node:test";
import { BrowserSpeech, browserSpeechSupported, type BrowserSpeechResult } from "../src/realtime/browserSpeech.ts";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = ""; continuous = false; interimResults = false; maxAlternatives = 0;
  onresult: any; onerror: any; onend: any; onspeechstart: any; onspeechend: any;
  constructor() { FakeRecognition.instances.push(this); }
  start() {}
  stop() { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Xin chào" } }] }); this.onend?.(); }
  abort() {}
}

test("Web Speech keeps interim/final ids and flushes final before stop resolves", async () => {
  (globalThis as any).webkitSpeechRecognition = FakeRecognition;
  const received: BrowserSpeechResult[] = [];
  let clock = 0;
  const speech = new BrowserSpeech("vi", () => clock, result => received.push(result), message => assert.fail(message));
  assert.equal(browserSpeechSupported(), true);
  speech.start();
  const engine = FakeRecognition.instances.at(-1)!;
  assert.equal(engine.lang, "vi-VN");
  clock = 500;
  engine.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Xin" } }] });
  clock = 1000;
  await speech.stop();
  assert.equal(received.length, 2);
  assert.equal(received[0].result_id, received[1].result_id);
  assert.equal(received[1].final, true);
  assert.equal(received[1].end_ms, 1000);
  speech.start();
  clock = 1500;
  await speech.stop();
  assert.notEqual(received[2].result_id, received[1].result_id);
  delete (globalThis as any).webkitSpeechRecognition;
});

test("permission/network errors stop recognition and report failure", () => {
  (globalThis as any).webkitSpeechRecognition = FakeRecognition;
  const errors: string[] = [];
  const speech = new BrowserSpeech("en", () => 0, () => assert.fail("Unexpected result"), message => errors.push(message));
  speech.start();
  const engine = FakeRecognition.instances.at(-1)!;
  assert.equal(engine.lang, "en-US");
  engine.onerror({ error: "network" });
  assert.match(errors[0], /kết nối mạng/);
  assert.equal(engine.onresult, null);
  speech.cancel();
  delete (globalThis as any).webkitSpeechRecognition;
});

function fixture() {
  (globalThis as any).webkitSpeechRecognition = FakeRecognition;
  const received: BrowserSpeechResult[] = [];
  let clock = 0;
  const speech = new BrowserSpeech("vi", () => clock, result => received.push(result), () => {});
  speech.start();
  const engine = FakeRecognition.instances.at(-1)!;
  return { speech, received, engine, emit(items: [string, boolean][], resultIndex = 0) {
    clock += 1000;
    engine.onresult({ resultIndex, results: items.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) });
  } };
}

test("several interim slots form one replaceable preview, including shrinking snapshots", () => {
  const f = fixture();
  try {
    f.emit([["Xin chào", false], ["mọi người", false]]);
    assert.equal(f.received.length, 1);
    assert.equal(f.received[0].text, "Xin chào mọi người");
    f.emit([["Xin chào", false]]);
    assert.equal(f.received[1].result_id, f.received[0].result_id);
    assert.equal(f.received[1].text, "Xin chào");
    f.emit([]);
    assert.equal(f.received[2].result_id, f.received[0].result_id);
    assert.equal(f.received[2].recognition_status, "withdrawn");
    assert.equal(f.received[2].text, "");
  } finally { f.speech.cancel(); }
});

test("finals consume the cumulative preview and leave only one new unfinished tail", () => {
  const f = fixture();
  try {
    f.emit([["Câu một", false], ["câu hai", false], ["câu ba", false]]);
    const previewId = f.received[0].result_id;
    f.emit([["Câu một.", true], ["Câu hai.", true], ["Câu ba", false]], 1);
    assert.equal(f.received[1].result_id, previewId);
    assert.equal(f.received[1].final, true);
    assert.equal(f.received[2].final, true);
    assert.equal(f.received[3].final, false);
    assert.equal(new Set(f.received.slice(1).map(item => item.result_id)).size, 3);
    assert.ok(f.received[2].start_ms >= f.received[1].end_ms);
    assert.ok(f.received[3].start_ms >= f.received[2].end_ms);
    f.emit([["Câu một.", true], ["Câu hai.", true], ["Câu ba hoàn chỉnh", false]], 2);
    assert.equal(f.received.length, 5, "Unchanged finals must not be emitted again");
    assert.equal(f.received[4].result_id, f.received[3].result_id);
    f.emit([["Câu một.", true], ["Câu hai.", true], ["Câu ba hoàn chỉnh.", true]], 2);
    assert.equal(f.received[5].result_id, f.received[3].result_id);
    assert.equal(f.received[5].final, true);
  } finally { f.speech.cancel(); }
});

test("natural engine restart archives the old draft and allocates a different active turn", async () => {
  const f = fixture();
  try {
    f.emit([["Chưa có kết quả cuối", false]]);
    f.engine.onend();
    assert.equal(f.received[1].recognition_status, "unconfirmed");
    assert.equal(f.received[1].final, false);
    await new Promise(resolve => setTimeout(resolve, 450));
    const next = FakeRecognition.instances.at(-1)!;
    assert.notEqual(next, f.engine);
    next.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Đang nói tiếp" } }] });
    assert.notEqual(f.received[2].result_id, f.received[0].result_id);
    assert.equal(f.received[2].recognition_status, undefined);
    assert.equal(f.received.filter(item => item.final).length, 0);
  } finally { f.speech.cancel(); }
});

test("stop/error without a final retains the draft and never fabricates a saved result", async () => {
  const f = fixture();
  f.emit([["Còn dang dở", false]]);
  f.engine.stop = () => f.engine.onend();
  await f.speech.stop();
  assert.equal(f.received.at(-1)!.recognition_status, "unconfirmed");
  assert.equal(f.received.some(item => item.final), false);
  const error = fixture();
  error.emit([["Mất mạng", false]]);
  error.engine.onerror({ error: "network" });
  assert.equal(error.received.at(-1)!.recognition_status, "unconfirmed");
  assert.equal(error.received.some(item => item.final), false);
});

function pcm(durationMs: number, amplitude = 0): ArrayBuffer {
  return new Int16Array(durationMs * 16).fill(amplitude).buffer;
}

test("1.5 seconds of PCM silence requests a real final and recognition continues automatically", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.emit([["Xin", false]]);
    f.speech.observeAudio(pcm(100, 3000));
    f.speech.observeAudio(pcm(1499));
    assert.equal(f.received.some(item => item.final), false);
    f.speech.observeAudio(pcm(1));
    assert.equal(f.received.at(-1)!.final, true);
    assert.equal(f.received.at(-1)!.text, "Xin chào", "Use the engine final, not the draft text");
    assert.equal(f.received.at(-1)!.result_id, f.received[0].result_id);
    context.mock.timers.tick(100);
    const next = FakeRecognition.instances.at(-1)!;
    assert.notEqual(next, f.engine);
    next.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Câu tiếp theo" } }] });
    assert.notEqual(f.received.at(-1)!.result_id, f.received[0].result_id);
  } finally { f.speech.cancel(); }
});

test("resumed microphone speech resets silence; delayed words do not", () => {
  const f = fixture();
  try {
    f.emit([["Xin", false]]);
    f.speech.observeAudio(pcm(1400));
    f.speech.observeAudio(pcm(100, 3000));
    f.speech.observeAudio(pcm(1400));
    assert.equal(f.received.some(item => item.final), false);
    f.emit([["Xin chào", false]]);
    f.speech.observeAudio(pcm(100));
    assert.equal(f.received.at(-1)!.final, true);
  } finally { f.speech.cancel(); }
});

test("speechend requests a final even without PCM silence; a new speechstart cancels it", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.emit([["Xin", false]]);
    f.engine.onspeechend();
    context.mock.timers.tick(1000);
    f.engine.onspeechstart();
    context.mock.timers.tick(1000);
    assert.equal(f.received.some(item => item.final), false);
    f.engine.onspeechend();
    context.mock.timers.tick(1500);
    assert.equal(f.received.at(-1)!.final, true);
  } finally { f.speech.cancel(); }
});

test("unchanged interim events or background noise cannot postpone the 8-second watchdog forever", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.emit([["Xin", false]]);
    context.mock.timers.tick(7000);
    f.speech.observeAudio(pcm(100, 3000));
    f.emit([["Xin", false]]);
    context.mock.timers.tick(1000);
    assert.equal(f.received.at(-1)!.final, true);
    assert.equal(f.received.filter(item => item.final).length, 1);
  } finally { f.speech.cancel(); }
});

test("a hung engine is restarted after the final wait and late callbacks cannot duplicate a final", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let stops = 0;
  let aborts = 0;
  f.engine.stop = () => { stops++; };
  f.engine.abort = () => { aborts++; };
  const lateResult = f.engine.onresult;
  try {
    f.emit([["Chưa chốt được", false]]);
    f.speech.observeAudio(pcm(1500));
    f.speech.observeAudio(pcm(1500));
    assert.equal(stops, 1);
    context.mock.timers.tick(5000);
    assert.equal(aborts, 1);
    assert.equal(f.received.at(-1)!.recognition_status, "unconfirmed");
    assert.equal(f.received.some(item => item.final), false);
    context.mock.timers.tick(100);
    assert.notEqual(FakeRecognition.instances.at(-1), f.engine);
    const count = f.received.length;
    lateResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Đến quá muộn" } }] });
    assert.equal(f.received.length, count);
  } finally { f.speech.cancel(); }
});

test("manual stop during automatic finalization waits for the same final and prevents restart", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let stops = 0;
  f.engine.stop = () => { stops++; };
  f.emit([["Xin", false]]);
  f.speech.observeAudio(pcm(1500));
  const stopping = f.speech.stop();
  assert.equal(stops, 1);
  f.engine.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Xin chào." } }] });
  f.engine.onend();
  await stopping;
  context.mock.timers.tick(10000);
  assert.equal(FakeRecognition.instances.at(-1), f.engine);
  assert.equal(f.received.filter(item => item.final).length, 1);
});

test("a native final delayed beyond the old 2.5-second deadline still replaces its draft", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let aborts = 0;
  f.engine.stop = () => {};
  f.engine.abort = () => { aborts++; };
  try {
    f.emit([["Nội dung tạm", false]]);
    f.speech.observeAudio(pcm(1500));
    context.mock.timers.tick(3500);
    assert.equal(aborts, 0);
    f.engine.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Nội dung đã chốt." } }] });
    f.engine.onend();
    assert.equal(f.received.at(-1)!.final, true);
    assert.equal(f.received.at(-1)!.text, "Nội dung đã chốt.");
  } finally { f.speech.cancel(); }
});

test("background near the measured RMS 0.019 counts toward silence instead of waiting 8 seconds", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.emit([["Xin", false]]);
    f.speech.observeAudio(pcm(100, 3000));
    const noise = [0.01901, 0.01887, 0.02044, 0.02341, 0.01844, 0.0175, 0.01672,
      0.01806, 0.01564, 0.01794, 0.02098, 0.01594, 0.01737, 0.01466, 0.01562];
    for (const rms of noise.slice(0, 14)) f.speech.observeAudio(pcm(100, Math.round(rms * 32768)));
    assert.equal(f.received.some(item => item.final), false);
    f.speech.observeAudio(pcm(100, Math.round(noise[14] * 32768)));
    assert.equal(f.received.at(-1)!.final, true);
    assert.equal(f.received.at(-1)!.text, "Xin chào");
  } finally { f.speech.cancel(); }
});

test("late interim revisions cannot postpone the silence clock or its watchdog", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.emit([["Xin", false]]);
    f.speech.observeAudio(pcm(1000, 623));
    f.emit([["Xin chào", false]]);
    f.speech.observeAudio(pcm(400, 623));
    f.emit([["Xin chào mọi người", false]]);
    assert.equal(f.received.some(item => item.final), false);
    f.speech.observeAudio(pcm(100, 623));
    assert.equal(f.received.at(-1)!.final, true);
  } finally { f.speech.cancel(); }
  // Even if PCM delivery stops partway through silence, late text cannot keep
  // pushing the fallback deadline out indefinitely.
  const stalled = fixture();
  try {
    stalled.emit([["Xin", false]]);
    stalled.speech.observeAudio(pcm(500, 623));
    context.mock.timers.tick(7000);
    stalled.emit([["Xin chào", false]]);
    context.mock.timers.tick(1000);
    assert.equal(stalled.received.at(-1)!.final, true);
  } finally { stalled.speech.cancel(); }
});

test("lower-volume speech above RMS 0.025 continues, while a brief pause does not close the turn", () => {
  const f = fixture();
  try {
    f.emit([["Đang nói", false]]);
    for (let i = 0; i < 30; i++) f.speech.observeAudio(pcm(100, 918)); // RMS ~0.028
    assert.equal(f.received.some(item => item.final), false);
    f.speech.observeAudio(pcm(1400, 623));
    f.speech.observeAudio(pcm(100, 918));
    f.speech.observeAudio(pcm(1400, 623));
    assert.equal(f.received.some(item => item.final), false);
    f.speech.observeAudio(pcm(100, 623));
    assert.equal(f.received.at(-1)!.final, true);
  } finally { f.speech.cancel(); }
});

test("two minutes of uninterrupted speech autosaves latest revisions without restarting recognition", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    for (let second = 0; second < 120; second++) {
      f.speech.observeAudio(pcm(1000, 3000));
      f.emit([[`Lời nói liên tục ${second}`, false]]);
      context.mock.timers.tick(1000);
    }
    const saved = f.received.filter(item => item.save_draft);
    assert.ok(saved.length >= 60 && saved.length <= 80);
    assert.equal(f.received.some(item => item.final), false);
    assert.equal(FakeRecognition.instances.at(-1), f.engine);
    assert.equal(new Set(saved.map(item => item.result_id)).size, 1);
    assert.ok(saved.every((item, i) => i === 0 || item.revision! > saved[i - 1].revision!));
    context.mock.timers.tick(1500);
    assert.equal(f.received.filter(item => item.save_draft).at(-1)!.text, "Lời nói liên tục 119");
  } finally { f.speech.cancel(); }
});

test("autosave repeats only for changed revisions and archives the newest text immediately on interruption", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.emit([["Bản nháp", false]]);
  context.mock.timers.tick(1500);
  assert.equal(f.received.filter(item => item.save_draft).length, 1);
  f.emit([["Bản nháp", false]]);
  context.mock.timers.tick(1500);
  assert.equal(f.received.filter(item => item.save_draft).length, 1);
  f.emit([["Bản nháp mới nhất", false]]);
  f.speech.cancel();
  assert.equal(f.received.at(-1)!.text, "Bản nháp mới nhất");
  assert.equal(f.received.at(-1)!.save_draft, true);
  assert.equal(f.received.at(-1)!.recognition_status, "unconfirmed");
  const count = f.received.length;
  context.mock.timers.tick(10000);
  assert.equal(f.received.length, count);
});
