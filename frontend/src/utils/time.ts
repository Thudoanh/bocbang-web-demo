/** Convert user-friendly timestamps to the millisecond contract used by the API. */
export function formatTimestampInput(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Accept mm:ss or hh:mm:ss, including fractional seconds. */
export function parseTimestampInput(value: string): number | undefined {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)$/);
  if (!match) return undefined;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60 || (match[1] !== undefined && minutes >= 60)) return undefined;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}
