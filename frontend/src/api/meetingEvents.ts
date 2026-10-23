export const MEETINGS_CHANGED = "bocbang:meetings-changed";
export const MEETING_SECTIONS_CHANGED = "bocbang:meeting-sections-changed";
export const MEETING_TRANSCRIPT_CHANGED = "bocbang:meeting-transcript-changed";

export function notifyMeetingTranscriptChanged(meetingId: string, reloadCurrent = false) {
  window.dispatchEvent(new CustomEvent(MEETING_TRANSCRIPT_CHANGED, { detail: { meetingId, reloadCurrent } }));
}

export function notifyMeetingSectionsChanged(meetingId: string) {
  window.dispatchEvent(new CustomEvent(MEETING_SECTIONS_CHANGED, { detail: { meetingId } }));
}

export function notifyMeetingsChanged<T>(result: T): T {
  window.dispatchEvent(new Event(MEETINGS_CHANGED));
  return result;
}
