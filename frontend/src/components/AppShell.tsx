import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, type IconName } from "./ui";

const primaryNav: Array<[string, IconName, string]> = [
  ["/meetings", "meeting", "Cuộc họp"],
  ["/settings", "profile", "Tài khoản"],
];

function pageLabel(path: string) {
  if (path === "/history") return "Cuộc họp";
  if (path === "/settings") return "Tài khoản";
  if (path === "/meetings/create") return "Cuộc họp mới";
  if (path.includes("/upload")) return "Tải bản ghi";
  if (path.includes("/summary")) return "Tóm tắt";
  if (path.includes("/speakers")) return "Người nói";
  if (path.includes("/translation")) return "Bản dịch";
  if (path.includes("/export-share")) return "Xuất & chia sẻ";
  if (path.match(/^\/meetings\/[^/]+$/)) return "Bản ghi";
  return "Cuộc họp";
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const path = window.location.pathname;
  const meetingMatch = path.match(/^\/meetings\/([^/]+)/)?.[1];
  const meetingId = meetingMatch === "create" ? undefined : meetingMatch;
  const initials = user?.full_name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "BB";
  const meetingNav: Array<[string, IconName, string]> = meetingId ? [
    [`/meetings/${meetingId}`, "meeting", "Bản ghi"],
    [`/meetings/${meetingId}/summary`, "summary", "Tóm tắt"],
    [`/meetings/${meetingId}/speakers`, "speaker", "Người nói"],
    [`/meetings/${meetingId}/translation`, "translate", "Dịch"],
    [`/meetings/${meetingId}/export-share`, "export", "Xuất"],
  ] : [];

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/meetings" aria-label="Bóc Băng">
        <span className="brand-mark"><Icon name="brand" /></span>
        <strong>Bóc Băng</strong>
      </a>
      <a className="btn btn-dark side-create" href="/meetings/create">
        <Icon name="plus" /> Mới
      </a>
      <nav className="primary-nav" aria-label="Điều hướng chính">
        {primaryNav.map(([href, icon, label]) => <a className={path === href || (href === "/meetings" && path === "/history") ? "selected" : ""} href={href} key={href}><Icon name={icon} />{label}</a>)}
      </nav>
      {meetingNav.length > 0 && <nav className="context-nav" aria-label="Công cụ cuộc họp">
        <span className="side-label">ĐANG MỞ</span>
        {meetingNav.map(([href, icon, label]) => <a className={path === href ? "selected" : ""} href={href} key={href}><Icon name={icon} />{label}</a>)}
      </nav>}
      <div className="account">
        <a className="account-profile" href="/settings">
          <span className="person-avatar">{initials}</span>
          <span><strong>{user?.full_name}</strong><small>{user?.email}</small></span>
        </a>
        <button className="logout-link" type="button" onClick={() => void logout()}>Thoát</button>
      </div>
    </aside>
    <main>
      <header className="topbar">
        <strong>{pageLabel(path)}</strong>
        <div className="top-icons">
          <ThemeToggle />
          <a className="top-avatar" href="/settings" aria-label="Mở tài khoản">{initials}</a>
        </div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>;
}
