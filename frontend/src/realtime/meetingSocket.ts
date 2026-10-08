import { config } from "../app/config";

export type RealtimeEvent =
  | { type: "session.ready"; provider: string; language: string; speaker_identification_available: boolean; fallback_active: boolean }
  | { type: "transcript.partial"; language: string; start_ms: number; end_ms: number; text: string; speaker_label?: string; speaker_name?: string; voice_profile_id?: string; is_identified?: boolean }
  | { type: "transcript.final"; language: string; start_ms: number; end_ms: number; text: string; logical_segment_id: string; speaker_id?: string; speaker_label?: string; speaker_name?: string; voice_profile_id?: string; is_identified?: boolean }
  | { type: "transcript.speaker_updated"; logical_segment_id: string; speaker_id: string | null; version_id: string; version_no: number }
  | { type: "meeting.status"; status: string }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "translation.status"; enabled: boolean; source_language?: string; target_language?: string }
  | { type: "translation.final"; logical_segment_id: string; source_language: string; target_language: string; text: string }
  | { type: "translation.error"; code: string; message: string; retryable: boolean; logical_segment_ids: string[] };

export class MeetingSocket {
  private socket?: WebSocket;
  private retry = 0;
  private retryTimer?: number;
  private stopped = false;

  constructor(
    private meetingId: string,
    private token: string,
    private onEvent: (event: RealtimeEvent) => void,
    private onStatus: (status: "connecting" | "connected" | "reconnecting" | "closed") => void,
  ) {}

  connect() {
    this.stopped = false;
    this.retry = 0;
    this.clearRetryTimer();
    this.open();
  }

  private open() {
    if (this.stopped) return;
    this.onStatus(this.retry ? "reconnecting" : "connecting");
    const url = new URL(`${config.wsBaseUrl}/realtime/${this.meetingId}`);
    url.searchParams.set("access_token", this.token);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data) as RealtimeEvent;
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
      this.onStatus("reconnecting");
      this.retryTimer = window.setTimeout(
        () => this.open(),
        Math.min(1000 * 2 ** this.retry, 15000),
      );
    };
  }

  sendAudio(chunk: Blob | ArrayBuffer) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(chunk);
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
