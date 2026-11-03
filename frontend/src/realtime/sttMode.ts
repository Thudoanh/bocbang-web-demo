import { useSyncExternalStore } from "react";

export type SttMode = "cloud" | "browser";
const key = "bocbang_stt_mode";
const eventName = "bocbang:stt-mode";

export function getDefaultSttMode(): SttMode {
  try { return localStorage.getItem(key) === "browser" ? "browser" : "cloud"; }
  catch { return "cloud"; }
}

export function setDefaultSttMode(mode: SttMode) {
  try { localStorage.setItem(key, mode); } catch { /* Private mode may block storage. */ }
  window.dispatchEvent(new Event(eventName));
}

function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useDefaultSttMode() {
  return useSyncExternalStore(subscribe, getDefaultSttMode, () => "cloud" as SttMode);
}
