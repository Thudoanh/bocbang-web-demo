export function route(pathname: string) {
  if (pathname === "/login") return { page: "auth" as const, mode: "login" as const };
  if (pathname === "/register") return { page: "auth" as const, mode: "register" as const };
  if (pathname === "/forgot-password") return { page: "auth" as const, mode: "forgot" as const };
  const share = pathname.match(/^\/share\/([^/]+)$/); if (share) return { page: "share" as const, token: share[1] };
  const speaker = pathname.match(/^\/meetings\/([^/]+)\/speakers$/); if (speaker) return { page: "speakers" as const, id: speaker[1] };
  const translation = pathname.match(/^\/meetings\/([^/]+)\/translation$/); if (translation) return { page: "translation" as const, id: translation[1] };
  const summary = pathname.match(/^\/meetings\/([^/]+)\/summary$/); if (summary) return { page: "summary" as const, id: summary[1] };
  const exportShare = pathname.match(/^\/meetings\/([^/]+)\/export-share$/); if (exportShare) return { page: "export-share" as const, id: exportShare[1] };
  const upload = pathname.match(/^\/meetings\/([^/]+)\/upload$/); if (upload) return { page: "upload" as const, id: upload[1] };
  if (pathname === "/meetings/create") return { page: "create" as const };
  const meeting = pathname.match(/^\/meetings\/([^/]+)$/); if (meeting) return { page: "meeting" as const, id: meeting[1] };
  if (pathname.startsWith("/voice-profiles")) return { page: "voice-profiles" as const };
  if (pathname === "/settings") return { page: "settings" as const };
  if (pathname === "/history") return { page: "history" as const };
  return { page: "create" as const };
}
