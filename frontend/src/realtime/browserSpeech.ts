/** Web Speech supplies text only; PCM recording/playback keeps its existing path. */
export type BrowserSpeechResult = {
  result_id: string; final: boolean; text: string; start_ms: number; end_ms: number;
  recognition_status?: "unconfirmed" | "withdrawn";
  revision?: number;
  save_draft?: boolean;
};

const timing: Array<{ phase: string; result_id?: string; at_ms: number; detail?: string }> = [];
/** Local bounded metadata only: no transcript text, audio or credentials. */
export function recordBrowserTiming(phase: string, result_id?: string, detail?: string) {
  timing.push({ phase, result_id, at_ms: Math.round(performance.now()), detail });
  if (timing.length > 200) timing.shift();
  if (typeof window !== "undefined") (window as Window & { browserSttTiming?: () => typeof timing }).browserSttTiming = () => [...timing];
}
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionConstructor = new () => Recognition;

const SILENCE_MS = 1500;
// Background RMS measured around 0.019 after the existing microphone gain.
// Keep this separate from the duration: raising it must not increase the wait.
const SILENCE_RMS = 0.025;
const STALLED_PREVIEW_MS = 8000;
// stop() only requests a result. Allow a delayed native final before aborting;
// fast finals still render immediately. An exhausted wait becomes recoverable.
const FINAL_WAIT_MS = 5000;
const AUTOSAVE_MS = 1500;

function constructorForBrowser(): RecognitionConstructor | undefined {
  const scope = globalThis as unknown as {
    SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function browserSpeechSupported() { return Boolean(constructorForBrowser()); }

export class BrowserSpeech {
  private recognition?: Recognition;
  private active = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private nextTurn = 0;
  private lastEnd = 0;
  private settle?: () => void;
  private preview?: BrowserSpeechResult;
  private quietAudioMs = 0;
  private speechEndTimer?: ReturnType<typeof setTimeout>;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private finalTimer?: ReturnType<typeof setTimeout>;
  private flushing?: Recognition;
  private autosaveTimer?: ReturnType<typeof setTimeout>;
  private lastAutosaveKey = "";

  constructor(
    private language: string,
    private audioTimeMs: () => number,
    private onResult: (result: BrowserSpeechResult) => void,
    private onError: (message: string) => void,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.open();
  }

  /** Observe the existing mono 16 kHz PCM; do not open another microphone. */
  observeAudio(chunk: ArrayBuffer) {
    const recognition = this.recognition;
    if (!this.active || !recognition || this.flushing || !chunk.byteLength) return;
    const samples = new Int16Array(chunk);
    let energy = 0;
    for (const value of samples) energy += (value / 32768) ** 2;
    if (Math.sqrt(energy / samples.length) >= SILENCE_RMS) {
      this.quietAudioMs = 0;
      clearTimeout(this.speechEndTimer);
    } else {
      this.quietAudioMs += samples.length / 16;
      if (this.preview && this.quietAudioMs >= SILENCE_MS) this.requestFinal(recognition, "silence");
    }
  }

  private open() {
    if (!this.active) return;
    const Constructor = constructorForBrowser();
    if (!Constructor) {
      this.fail("Trình duyệt không hỗ trợ Web Speech. Hãy dùng Chrome trên máy tính hoặc chọn Cloud trước khi ghi âm.");
      return;
    }
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = this.language.startsWith("en") ? "en-US" : "vi-VN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    const finalized = new Set<number>();
    let speechStart = Math.max(this.lastEnd, this.audioTimeMs());
    this.quietAudioMs = 0;
    recognition.onspeechstart = () => {
      speechStart = Math.max(this.lastEnd, this.audioTimeMs());
      this.quietAudioMs = 0;
      clearTimeout(this.speechEndTimer);
    };
    recognition.onspeechend = () => {
      clearTimeout(this.speechEndTimer);
      this.speechEndTimer = setTimeout(() => {
        if (this.preview) this.requestFinal(recognition, "speech-end");
      }, SILENCE_MS);
    };
    recognition.onresult = event => {
      if (this.recognition !== recognition) return;
      // results is a replaceable snapshot. Several interim slots belong to ONE
      // unfinished tail; slots may also shrink or disappear on the next event.
      const finals: string[] = [];
      const interim: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (!finalized.has(i) && text) finals.push(text);
          finalized.add(i);
        } else if (text) interim.push(text);
      }
      const tail = interim.join(" ");
      const parts = [...finals, ...(tail ? [tail] : [])];
      let start = Math.max(this.lastEnd, this.preview?.start_ms ?? speechStart);
      const end = Math.max(start + parts.length, this.audioTimeMs());
      const totalWeight = parts.reduce((sum, text) => sum + text.length, 0);
      let weight = 0;
      const intervalStart = start;
      for (const text of finals) {
        weight += text.length;
        const partEnd = Math.max(start + 1, Math.round(intervalStart + (end - intervalStart) * weight / totalWeight));
        this.onResult({ result_id: this.preview?.result_id ?? this.allocateId(), final: true,
          text, start_ms: start, end_ms: partEnd, revision: (this.preview?.revision ?? 0) + 1 });
        recordBrowserTiming("engine.final", this.preview?.result_id ?? `turn:${this.nextTurn - 1}`);
        this.preview = undefined;
        this.lastEnd = partEnd;
        speechStart = partEnd;
        start = partEnd;
      }
      if (tail) {
        const newPreview = !this.preview;
        const changed = this.preview?.text !== tail || finals.length > 0;
        this.preview = { result_id: this.preview?.result_id ?? this.allocateId(), final: false,
          text: tail, start_ms: start, end_ms: Math.max(start + 1, end),
          revision: (this.preview?.revision ?? 0) + (changed ? 1 : 0) };
        this.onResult(this.preview);
        recordBrowserTiming("engine.partial", this.preview.result_id);
        this.scheduleAutosave();
        if (!this.flushing && (newPreview || (changed && this.quietAudioMs === 0))) {
          // Recognition can revise text after the speaker has stopped. Only
          // microphone activity may reset silence, not a delayed text event.
          // Such revisions must not postpone the fallback watchdog either.
          clearTimeout(this.previewTimer);
          this.previewTimer = setTimeout(() => this.requestFinal(recognition, "stalled"), STALLED_PREVIEW_MS);
        }
      } else if (this.preview) {
        this.onResult({ ...this.preview, text: "", recognition_status: "withdrawn", revision: (this.preview.revision ?? 0) + 1 });
        this.preview = undefined;
      }
      if (!this.preview) clearTimeout(this.previewTimer);
    };
    recognition.onerror = event => {
      if (this.recognition !== recognition || !this.active) return;
      if (event.error === "no-speech") return; // Normal silence; onend restarts recognition.
      const messages: Record<string, string> = {
        "not-allowed": "Cần cho phép microphone và Web Speech trong trình duyệt.",
        "service-not-allowed": "Dịch vụ Web Speech bị trình duyệt hoặc chính sách thiết bị chặn.",
        "audio-capture": "Web Speech không truy cập được microphone.",
        "network": "Web Speech mất kết nối mạng. Hãy kiểm tra mạng rồi kết nối lại.",
        "language-not-supported": "Web Speech không hỗ trợ ngôn ngữ đã chọn trên thiết bị này.",
      };
      this.fail(messages[event.error] ?? `Web Speech dừng nhận diện (${event.error}).`);
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.finishRecognition(recognition);
    };
    try { recognition.start(); }
    catch (cause) { this.fail(cause instanceof Error ? cause.message : "Không thể khởi động Web Speech."); }
  }

  /** Let the engine deliver its last final before sending pause/stop to the server. */
  async stop() {
    this.active = false;
    clearTimeout(this.restartTimer);
    const recognition = this.recognition;
    if (!recognition) return;
    await new Promise<void>(resolve => {
      this.settle = resolve;
      this.requestFinal(recognition);
    });
  }

  /** stop() requests an actual engine final. Keep PCM recording and the socket
   * running; onend opens a new recognition turn for the next sentence. */
  private requestFinal(recognition: Recognition, reason = "manual") {
    if (this.recognition !== recognition || this.flushing === recognition) return;
    recordBrowserTiming("engine.stop-requested", this.preview?.result_id, reason);
    this.flushing = recognition;
    clearTimeout(this.speechEndTimer);
    clearTimeout(this.previewTimer);
    this.finalTimer = setTimeout(() => this.finishRecognition(recognition, true), FINAL_WAIT_MS);
    try { recognition.stop(); }
    catch { this.finishRecognition(recognition, true); }
  }

  private finishRecognition(recognition: Recognition, abort = false) {
    if (this.recognition !== recognition) return;
    const wasFlushing = this.flushing === recognition;
    recordBrowserTiming(abort ? "engine.final-timeout" : "engine.ended", this.preview?.result_id,
      this.preview ? "unconfirmed" : "final-received");
    this.recognition = undefined;
    this.flushing = undefined;
    this.clearTurnTimers();
    this.detach(recognition);
    if (abort) { try { recognition.abort(); } catch { /* Already ended. */ } }
    this.archivePreview();
    this.settle?.(); this.settle = undefined;
    if (this.active) this.restartTimer = setTimeout(() => this.open(), wasFlushing ? 100 : 400);
  }

  cancel() {
    this.active = false;
    clearTimeout(this.restartTimer);
    this.clearTurnTimers();
    this.flushing = undefined;
    const recognition = this.recognition;
    this.recognition = undefined;
    if (recognition) {
      this.detach(recognition);
      try { recognition.abort(); } catch { /* Already stopped. */ }
    }
    this.archivePreview();
    this.settle?.(); this.settle = undefined;
  }

  private allocateId() { return `turn:${this.nextTurn++}`; }

  private scheduleAutosave() {
    if (this.autosaveTimer) return;
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = undefined;
      if (!this.preview || !this.recognition) return;
      const key = `${this.preview.result_id}:${this.preview.revision}`;
      if (key !== this.lastAutosaveKey) {
        this.lastAutosaveKey = key;
        recordBrowserTiming("draft.send", this.preview.result_id);
        this.onResult({ ...this.preview, save_draft: true });
      }
      this.scheduleAutosave();
    }, AUTOSAVE_MS);
  }

  private clearTurnTimers() {
    clearTimeout(this.speechEndTimer);
    clearTimeout(this.previewTimer);
    clearTimeout(this.finalTimer);
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = undefined;
  }

  private detach(recognition: Recognition) {
    recognition.onresult = recognition.onerror = recognition.onend = recognition.onspeechstart = recognition.onspeechend = null;
  }

  private archivePreview() {
    if (!this.preview) return;
    this.onResult({ ...this.preview, recognition_status: "unconfirmed", save_draft: true,
      revision: (this.preview.revision ?? 0) + 1 });
    this.lastEnd = Math.max(this.lastEnd, this.preview.end_ms);
    this.preview = undefined;
  }

  private fail(message: string) { this.cancel(); this.onError(message); }
}
