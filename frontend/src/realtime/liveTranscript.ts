import type { RealtimeEvent } from "./meetingSocket";

export type TranscriptEvent = Extract<RealtimeEvent, { type: "transcript.partial" | "transcript.final" }>;
export type LiveTranscript = Record<string, TranscriptEvent>;

export function segmentKey(event: TranscriptEvent): string {
  if (event.type === "transcript.final") return `final:${event.logical_segment_id}`;
  return event.stream_segment_id ?? `${event.stream_start_ms ?? event.start_ms}:${event.speaker_label ?? ""}`;
}

export function updateLiveTranscript(current: LiveTranscript, event: TranscriptEvent): LiveTranscript {
  const next = { ...current };
  const start = event.stream_start_ms ?? event.start_ms;
  const end = event.stream_end_ms ?? event.end_ms;
  for (const [key, previous] of Object.entries(next)) {
    if (previous.type === "transcript.final") continue;
    const previousStart = previous.stream_start_ms ?? previous.start_ms;
    const previousEnd = previous.stream_end_ms ?? previous.end_ms;
    // A finalized old turn must never erase a newer interim turn.
    if ((event.type === "transcript.partial" && key === segmentKey(event)) || (
      previous.speaker_label === event.speaker_label && previousStart >= start && previousEnd <= end
    )) delete next[key];
  }
  next[segmentKey(event)] = event;
  return next;
}
