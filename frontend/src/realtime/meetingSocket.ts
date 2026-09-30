import { config } from "../app/config";
export type RealtimeEvent = { type: "session.ready" | "transcript.partial" | "transcript.final" | "meeting.status" | "error"; [key: string]: unknown };

export class MeetingSocket {
  private socket?: WebSocket; private retry = 0; private stopped = false;
  constructor(private meetingId: string, private token: string, private onEvent: (event: RealtimeEvent) => void, private onStatus: (status: "connecting" | "connected" | "reconnecting" | "closed") => void) {}
  connect() {
    this.stopped = false; this.onStatus(this.retry ? "reconnecting" : "connecting");
    const url = new URL(`${config.wsBaseUrl}/realtime/${this.meetingId}`); url.searchParams.set("access_token", this.token);
    this.socket = new WebSocket(url);
    this.socket.onopen = () => { this.retry = 0; this.onStatus("connected"); };
    this.socket.onmessage = ({ data }) => { try { const event = JSON.parse(data) as RealtimeEvent; if (event.type === "error" && event.retryable === false) this.stopped = true; this.onEvent(event); } catch { this.onEvent({ type: "error", message: "Sự kiện realtime không hợp lệ." }); } };
    this.socket.onclose = () => { if (this.stopped) return this.onStatus("closed"); this.retry += 1; this.onStatus("reconnecting"); window.setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry, 15000)); };
  }
  sendAudio(chunk: Blob) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(chunk); }
  command(command: "recording.pause" | "recording.resume" | "recording.stop") { if (command === "recording.stop") this.stopped = true; this.socket?.send(JSON.stringify({ type: command })); }
  close() { this.stopped = true; this.socket?.close(); }
}
