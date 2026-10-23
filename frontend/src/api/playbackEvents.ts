export const MEETING_PLAYBACK_CHANGED = "bocbang:playback-changed";
export const MEETING_PLAYBACK_SEEK = "bocbang:playback-seek";
export const MEETING_PLAYBACK_TIME = "bocbang:playback-time";

export function notifyMeetingPlaybackChanged(meetingId: string) {
  window.dispatchEvent(new CustomEvent(MEETING_PLAYBACK_CHANGED, { detail: { meetingId } }));
}
export function seekMeetingPlayback(meetingId: string, milliseconds: number) {
  window.dispatchEvent(new CustomEvent(MEETING_PLAYBACK_SEEK, { detail: { meetingId, milliseconds } }));
}
