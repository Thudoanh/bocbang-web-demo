import { config } from "../app/config";
export type RealtimeEvent = { type: "session.ready" | "transcript.partial" | "transcript.final" | "meeting.status" | "error"; [key: string]: unknown };

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
        this.onEvent({ type: "error", message: "Sự kiện realtime không hợp lệ.", retryable: false });
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
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: command }));
    }
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
}