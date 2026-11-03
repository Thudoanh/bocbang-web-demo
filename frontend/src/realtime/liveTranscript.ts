import type { RealtimeEvent, BrowserDraftEvent } from "./meetingSocket";

export type TranscriptEvent = Extract<RealtimeEvent, { type: "transcript.partial" | "transcript.final" }>;
export type LiveTranscriptEntry = TranscriptEvent & { recognition_status?: "unconfirmed" | "withdrawn"; updated_at?: number };
export type LiveTranscript = Record<string, LiveTranscriptEntry>;

export function browserDraftLabel(event: LiveTranscriptEntry): string {
  if (event.type === "transcript.final") return "Đã xác nhận";
  if (event.awaiting_final) return "Đang lưu bản cuối";
  if (event.draft_saved_revision !== undefined) {
    return event.draft_saved_revision === event.revision ? "Đã lưu tạm · chưa xác nhận"
      : "Có bản lưu tạm · đang cập nhật";
  }
  return event.recognition_status === "unconfirmed" ? "Chưa xác nhận · chưa lưu" : "Đang nhận diện";
}

export function restoreBrowserDrafts(current: LiveTranscript, drafts: BrowserDraftEvent[]): LiveTranscript {
  return drafts.reduce((state, event) => updateLiveTranscript(state, {
    ...event, recognition_status: state[segmentKey(event)]?.recognition_status ?? "unconfirmed",
  }), current);
}

export function interruptBrowserSession(current: LiveTranscript, scope: string): LiveTranscript {
  return Object.fromEntries(Object.entries(current).map(([key, event]) => [key,
    event.type === "transcript.partial" && event.stream_segment_id?.startsWith(scope + ":")
      ? { ...event, recognition_status: "unconfirmed", awaiting_final: false } : event,
  ]));
}

/** Retain unfinished text honestly after the connection has ended. */
export function finishLiveTranscript(current: LiveTranscript): LiveTranscript {
  return Object.fromEntries(Object.entries(current).map(([key, event]) => [key,
    event.type === "transcript.partial" ? { ...event, recognition_status: "unconfirmed", awaiting_final: false } : event,
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

export function pruneStalePartials(current: LiveTranscript, maxAgeMs = 4000, preserveDrafts = false): LiveTranscript {
  const now = Date.now();
  let changed = false;
  const next: LiveTranscript = {};
  for (const [key, event] of Object.entries(current)) {
    if (event.type === "transcript.partial" && !preserveDrafts && event.recognition_status !== "unconfirmed") {
      const age = now - (event.updated_at ?? now);
      if (age > maxAgeMs) {
        changed = true;
        continue;
      }
    }
    next[key] = event;
  }
  return changed ? next : current;
}

/** Stored times are meeting-relative; stream times restart on each connection.
 * Identified turns are reconciled by ID, never by another turn's end time. */
export function reconcileStoredTranscript(current: LiveTranscript, segments: readonly { logical_segment_id: string; end_ms: number }[]): LiveTranscript {
  const stored = new Set(segments.map(segment => segment.logical_segment_id));
  const maxEnd = Math.max(0, ...segments.map(segment => segment.end_ms));
  return Object.fromEntries(Object.entries(current).filter(([, event]) =>
    event.type === "transcript.final" ? !stored.has(event.logical_segment_id)
      : hasTurnId(event.stream_segment_id) || event.recognition_status === "unconfirmed" || event.end_ms > maxEnd
  ));
}

export function updateLiveTranscript(current: LiveTranscript, event: TranscriptEvent): LiveTranscript {
  const next = { ...current };
  const start = event.stream_start_ms ?? event.start_ms;
  const end = event.stream_end_ms ?? event.end_ms;
  const prevTrans = current[segmentKey(event)]?.translation;
  const previous = current[segmentKey(event)];
  const saved = previous?.draft_saved_revision !== undefined && (
    event.draft_saved_revision === undefined || previous.draft_saved_revision > event.draft_saved_revision
  ) ? { draft_saved_revision: previous.draft_saved_revision, draft_saved_at: previous.draft_saved_at }
    : { draft_saved_revision: event.draft_saved_revision, draft_saved_at: event.draft_saved_at };

  // Saving an older snapshot must acknowledge durability without rolling text
  // back over a newer optimistic preview. Revision 0 is the legacy protocol.
  if (event.type === "transcript.partial" && previous?.type === "transcript.partial" &&
      (event.revision ?? 0) < (previous.revision ?? 0)) {
    return { ...current, [segmentKey(event)]: { ...previous, ...saved } };
  }

  if (event.type === "transcript.partial" && (!event.text || !event.text.trim())) {
    delete next[segmentKey(event)];
    return next;
  }

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
  next[segmentKey(event)] = { ...event, ...saved,
    translation: event.translation || (previous?.text === event.text ? prevTrans : undefined), updated_at: Date.now() };
  return next;
}
