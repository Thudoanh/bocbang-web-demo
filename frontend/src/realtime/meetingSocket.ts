import { config } from "../app/config";
import { recordArrival } from "./diagnostics";
import { recordBrowserTiming, type BrowserSpeechResult } from "./browserSpeech";

type TranscriptTrace = {
  event_id?: string; stream_segment_id?: string; backend_queue_ms?: number;
  stream_start_ms?: number; stream_end_ms?: number;
  revision?: number; draft_saved_revision?: number; draft_saved_at?: string;
  browser_result_id?: string;
  awaiting_final?: boolean;
};

export type BrowserDraftEvent = { type: "transcript.partial"; language: string; text: string;
  start_ms: number; end_ms: number; stream_segment_id: string;
  recognition_status?: "unconfirmed" | "withdrawn" } & TranscriptTrace;

export type RealtimeEvent =
  | { type: "session.ready"; provider: string; language: string; stt_mode?: "cloud" | "browser"; speaker_identification_available: boolean; fallback_active: boolean; stream_session_id?: string; time_offset_ms?: number }
  | { type: "transcript.drafts"; drafts: BrowserDraftEvent[] }
  | { type: "transcript.interrupted"; stream_session_id: string }
  | ({ type: "transcript.partial"; recognition_status?: "unconfirmed" | "withdrawn"; language: string; start_ms: number; end_ms: number; text: string; translation?: string; speaker_label?: string; speaker_name?: string; voice_profile_id?: string; is_identified?: boolean } & TranscriptTrace)
  | ({ type: "transcript.final"; language: string; start_ms: number; end_ms: number; text: string; translation?: string; logical_segment_id: string; speaker_id?: string; speaker_label?: string; speaker_name?: string; voice_profile_id?: string; is_identified?: boolean } & TranscriptTrace)
  | { type: "transcript.speaker_updated"; logical_segment_id: string; speaker_id: string | null; version_id: string; version_no: number }
  | { type: "meeting.status"; status: string }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "translation.status"; enabled: boolean; source_language?: string; target_language?: string }
  | { type: "translation.partial"; stream_segment_id: string; source_language: string; target_language: string; text: string; source_text?: string }
  | { type: "translation.final"; logical_segment_id: string; source_language: string; target_language: string; text: string }
  | { type: "translation.error"; code: string; message: string; retryable: boolean; logical_segment_ids: string[] };

export class MeetingSocket {
  private socket?: WebSocket;
  private retry = 0;
  private retryTimer?: number;
  private stopped = false;
  private token?: string;
  private getToken?: () => Promise<string | undefined>;

  constructor(
    private meetingId: string,
    tokenOrGetter: string | (() => Promise<string | undefined>),
    private onEvent: (event: RealtimeEvent) => void,
    private onStatus: (status: "connecting" | "connected" | "reconnecting" | "closed") => void,
  ) {
    if (typeof tokenOrGetter === "function") {
      this.getToken = tokenOrGetter;
    } else {
      this.token = tokenOrGetter;
    }
  }

  connect() {
    this.stopped = false;
    this.retry = 0;
    this.clearRetryTimer();
    void this.open();
  }

  private async open() {
    if (this.stopped) return;
    this.onStatus(this.retry ? "reconnecting" : "connecting");
    let activeToken = this.token;
    if (this.getToken) {
      try {
        const refreshed = await this.getToken();
        if (refreshed) activeToken = refreshed;
      } catch {
        // use fallback if present
      }
    }
    const url = new URL(`${config.wsBaseUrl}/realtime/${this.meetingId}`);
    if (activeToken) {
      url.searchParams.set("access_token", activeToken);
    }
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data) as RealtimeEvent;
        if (event.type === "transcript.partial" || event.type === "transcript.final") {
          recordArrival(event);
          if (event.revision !== undefined) recordBrowserTiming(event.type === "transcript.final" ? "backend.final" : event.draft_saved_at ? "backend.draft-saved" : "backend.partial",
            event.browser_result_id ?? event.stream_segment_id, String(event.backend_queue_ms ?? ""));
        }
        if (event.type === "session.ready") {
          this.retry = 0;
          this.onStatus("connected");
        }
        if (event.type === "error" && event.retryable === false) {
          this.stopped = true;
          this.clearRetryTimer();
        }
        this.onEvent(event);
      } catch {
        this.onEvent({ type: "error", code: "INVALID_REALTIME_EVENT", message: "Sự kiện realtime không hợp lệ.", retryable: false });
        this.stopped = true;
      }
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) {
        this.onStatus("closed");
        return;
      }
      this.retry += 1;
      if (this.retry > 20) {
        this.stopped = true;
        this.clearRetryTimer();
        this.onStatus("closed");
        this.onEvent({
          type: "error",
          code: "WEBSOCKET_CONNECTION_FAILED",
          message: "Không thể kết nối WebSocket với máy chủ sau nhiều lần thử lại.",
          retryable: false,
        });
        return;
      }
      this.onStatus("reconnecting");
      this.retryTimer = window.setTimeout(
        () => void this.open(),
        Math.min(1000 * 1.5 ** Math.min(this.retry, 6), 5000),
      );
    };
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendAudio(chunk: Blob | ArrayBuffer) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(chunk);
  }

  sendBrowserTranscript(payload: BrowserSpeechResult) {
    this.sendCommand({ type: "transcript.browser", ...payload });
  }

  command(command: "recording.pause" | "recording.resume" | "recording.stop") {
    if (command === "recording.stop") {
      this.stopped = true;
      this.clearRetryTimer();
    }
    this.sendCommand({ type: command });
  }

  enableTranslation(targetLanguage: string, logicalSegmentIds: string[]) {
    this.sendCommand({
      type: "translation.enable",
      target_language: targetLanguage,
      logical_segment_ids: logicalSegmentIds,
    });
  }

  disableTranslation() {
    this.sendCommand({ type: "translation.disable" });
  }

  close() {
    this.stopped = true;
    this.clearRetryTimer();
    this.socket?.close();
  }

  private clearRetryTimer() {
    if (this.retryTimer !== undefined) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private sendCommand(payload: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
