import type { ReactNode } from "react";
import { meetingsApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { Icon, type IconName } from "./ui";

const nav: Array<[string, IconName, string]> = [["/meetings", "meeting", "Danh sách phiên họp"], ["/history", "history", "Lịch sử bản ghi"], ["/settings", "profile", "Hồ sơ cá nhân"]];
function pageLabel(path: string) { if (path === "/history") return "Lịch sử bản ghi"; if (path === "/settings") return "Hồ sơ cá nhân"; if (path.includes("/upload")) return "Tải lên & xử lý file"; if (path.match(/^\/meetings\/[^/]+$/)) return "Phiên họp / Phát lại"; return "Tạo phiên họp"; }

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const recent = useAsync(meetingsApi.list, []); const path = window.location.pathname;
  const currentMeeting = path.match(/^\/meetings\/([^/]+)/)?.[1]; const uploadHref = currentMeeting ? `/meetings/${currentMeeting}/upload` : recent.data?.[0] ? `/meetings/${recent.data[0].id}/upload` : "/meetings";
  const contextualNav: Array<[string, IconName, string]> = currentMeeting ? [[`/meetings/${currentMeeting}/summary`, "summary", "Tóm tắt AI & Biên bản"], [`/meetings/${currentMeeting}/speakers`, "speaker", "Quản lý người nói"], [`/meetings/${currentMeeting}/translation`, "translate", "Dịch thuật song ngữ"], [`/meetings/${currentMeeting}/export-share`, "export", "Xuất & chia sẻ"]] : [];
  const initials = user?.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "BB";
  return <div className="shell"><aside className="sidebar">
    <a className="brand" href="/meetings" aria-label="Bóc Băng AI"><span className="brand-mark"><Icon name="brand" /></span><span><strong>Bóc Băng AI</strong><small>Audio Intelligence · v2.4</small></span></a>
    <div className="side-actions"><a className="btn btn-dark" href="/meetings"><Icon name="plus" />Tạo phiên họp mới</a><a className="btn btn-light" href={uploadHref}><Icon name="upload" />Tải lên bản ghi</a></div>
    <label className="sidebar-search"><Icon name="search" /><input aria-label="Tìm kiếm bản ghi" placeholder="Tìm kiếm bản ghi..." /></label>
    <section className="sidebar-section recent-meetings"><span className="side-label">DANH MỤC CUỘC HỌP</span>{recent.data?.slice(0, 3).map((meeting) => <a key={meeting.id} className={path.includes(meeting.id) ? "selected" : ""} href={`/meetings/${meeting.id}`}><span><Icon name="meeting" /></span><b>{meeting.title}</b><small>{meeting.duration_ms ? `${Math.round(meeting.duration_ms / 60000)} phút` : meeting.status}</small></a>)}{recent.data && recent.data.length === 0 && <p className="sidebar-empty">Chưa có phiên họp gần đây.</p>}</section>
    <nav aria-label="Công cụ và quản lý" className="sidebar-section"><span className="side-label">CÔNG CỤ &amp; QUẢN LÝ</span>{contextualNav.map(([href, icon, label]) => <a className={path === href ? "selected" : ""} href={href} key={href}><span><Icon name={icon} /></span>{label}</a>)}{nav.map(([href, icon, label]) => <a className={path === href ? "selected" : ""} href={href} key={href}><span><Icon name={icon} /></span>{label}</a>)}</nav>
    <div className="account"><a className="account-profile" href="/settings"><span className="person-avatar">{initials}</span><span><strong>{user?.full_name}</strong><small>{user?.email}</small></span><i>•••</i></a><button className="logout-link" type="button" onClick={() => void logout()}>Đăng xuất</button></div>
  </aside><main><header className="topbar"><div className="top-left"><span className="back-mark"><Icon name="back" /></span><span className="top-divider" /><span>{pageLabel(path)}</span></div><span className="environment"><i /> Kết nối API</span><span className="top-icons"><Icon name="settings" /><Icon name="profile" /></span></header><div className="content">{children}</div></main></div>;
}
