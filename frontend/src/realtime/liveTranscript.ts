import type { RealtimeEvent } from "./meetingSocket";

export type TranscriptEvent = Extract<RealtimeEvent, { type: "transcript.partial" | "transcript.final" }>;
export type LiveTranscriptEntry = TranscriptEvent & { recognition_status?: "unconfirmed" };
export type LiveTranscript = Record<string, LiveTranscriptEntry>;

/** Retain unfinished text honestly after the connection has ended. */
export function finishLiveTranscript(current: LiveTranscript): LiveTranscript {
  return Object.fromEntries(Object.entries(current).map(([key, event]) => [key,
    event.type === "transcript.partial" ? { ...event, recognition_status: "unconfirmed" } : event,
  ]));
}

export function segmentKey(event: TranscriptEvent): string {
  if (event.type === "transcript.final") return `final:${event.logical_segment_id}`;
  return event.stream_segment_id ?? `${event.stream_start_ms ?? event.start_ms}:${event.speaker_label ?? ""}`;
}

function sessionScope(id?: string): string | undefined {
  return id?.match(/^(.*):turn:\d+$/)?.[1];
}

function hasTurnId(id?: string): boolean {
  return Boolean(id?.match(/(?:^|:)turn:\d+$/));
}

export function updateLiveTranscript(current: LiveTranscript, event: TranscriptEvent): LiveTranscript {
  const next = { ...current };
  const start = event.stream_start_ms ?? event.start_ms;
  const end = event.stream_end_ms ?? event.end_ms;
  for (const [key, previous] of Object.entries(next)) {
    const sameTurn = Boolean(event.stream_segment_id && previous.stream_segment_id === event.stream_segment_id);
    const sameSession = sessionScope(previous.stream_segment_id) === sessionScope(event.stream_segment_id);
    const legacyCoverage = !hasTurnId(previous.stream_segment_id) || !hasTurnId(event.stream_segment_id);
    const previousStart = previous.stream_start_ms ?? previous.start_ms;
    const previousEnd = previous.stream_end_ms ?? previous.end_ms;
    if (previous.type === "transcript.final") {
      // Ignore an obsolete preview delivered after its turn was finalized.
      if (event.type === "transcript.partial" && sameTurn && (hasTurnId(event.stream_segment_id) || end <= previousEnd)) return current;
      continue;
    }
    // A finalized old turn must never erase a newer interim turn.
    if ((event.type === "transcript.partial" && key === segmentKey(event)) || (
      sameTurn && event.type === "transcript.final" && (hasTurnId(event.stream_segment_id) || previousEnd <= end)
    ) || (
      legacyCoverage && sameSession && previous.language === event.language && previous.speaker_label === event.speaker_label && previousStart >= start && previousEnd <= end
    )) delete next[key];
  }
  next[segmentKey(event)] = event;
  return next;
}
