import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./ui";

const links = [["/meetings", "Cuộc họp"], ["/history", "Lịch sử"], ["/settings", "Cài đặt"]] as const;
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const path = window.location.pathname;
  return <div className="shell"><aside className="sidebar"><a className="brand" href="/meetings"><span>〰</span> Bóc Băng AI</a><nav>{links.map(([href, label]) => <a className={path.startsWith(href) ? "selected" : ""} href={href} key={href}>{label}</a>)}</nav><div className="account"><strong>{user?.full_name}</strong><small>{user?.email}</small><Button onClick={() => void logout()} aria-label="Đăng xuất">Đăng xuất</Button></div></aside><main><header className="topbar"><span>Không gian làm việc</span><span className="online">● Kết nối API</span></header><div className="content">{children}</div></main></div>;
}
