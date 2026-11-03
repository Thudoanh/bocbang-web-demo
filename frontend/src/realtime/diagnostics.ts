import type { TranscriptEvent } from "./liveTranscript";

const arrivals = new Map<string, number>();
const samples: Array<Record<string, string | number>> = [];

function enabled(): boolean {
  return localStorage.getItem("sttDiagnostics") === "1";
}

export function recordArrival(event: TranscriptEvent) {
  if (!enabled() || !event.event_id) return;
  arrivals.set(event.event_id, performance.now());
  if (arrivals.size > 200) arrivals.delete(arrivals.keys().next().value!);
}

export function recordRender(event: TranscriptEvent) {
  if (!enabled() || !event.event_id) return;
  const arrived = arrivals.get(event.event_id);
  if (arrived === undefined) return;
  arrivals.delete(event.event_id);
  const sample = {
    event_id: event.event_id,
    type: event.type,
    stream_segment_id: event.stream_segment_id ?? "",
    stream_end_ms: event.stream_end_ms ?? event.end_ms,
    backend_queue_ms: event.backend_queue_ms ?? 0,
    browser_render_ms: Math.round((performance.now() - arrived) * 100) / 100,
  };
  samples.push(sample);
  if (samples.length > 200) samples.shift();
  console.debug("STT timing", sample);
  (window as Window & { sttTimingSamples?: typeof timingSamples }).sttTimingSamples = timingSamples;
}

export function timingSamples() { return [...samples]; }
