export const SIDEBAR_COLLAPSED_KEY = "bocbang-sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; }
  catch { return false; }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed)); }
  catch { /* Storage can be disabled; the current layout still works in memory. */ }
}
