import { Fragment, useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { PasswordModal } from "./PasswordModal";
import { MeetingHistory } from "./MeetingHistory";
import { MeetingSectionsDialog } from "./MeetingSections";
import { TranscriptPolishTool } from "./TranscriptPolishTool";
import { MeetingToolbarContext } from "./MeetingToolbarContext";
import { ToolbarTooltip } from "./ToolbarTooltip";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";
import { MeetingPlaybackTool } from "./MeetingPlaybackTool";
import { readSidebarCollapsed, saveSidebarCollapsed } from "../utils/sidebarPreference";
import { Icon, type IconName, Button } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, updateProfile, updatePassword } = useAuth();
  const path = window.location.pathname;
  const meetingMatch = path.match(/^\/meetings\/([^/]+)/)?.[1];
  const meetingId = meetingMatch === "create" ? undefined : meetingMatch;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia?.("(max-width: 820px)").matches ?? false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const sidebarVisible = isMobile ? sidebarOpen : !sidebarCollapsed;
  const recordingPage = Boolean(meetingId && path === `/meetings/${meetingId}`);
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);

  const [profileModal, setProfileModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [recordingHost, setRecordingHost] = useState<HTMLDivElement | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);

  useEffect(() => { saveSidebarCollapsed(sidebarCollapsed); }, [sidebarCollapsed]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 820px)");
    const change = () => {
      if (sidebarRef.current?.contains(document.activeElement)) sidebarTrigger.current?.focus();
      setIsMobile(query.matches); setSidebarOpen(false); setMenuOpen(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  function toggleSidebar() {
    setMenuOpen(false);
    if (isMobile) setSidebarOpen((open) => !open);
    else setSidebarCollapsed((collapsed) => !collapsed);
  }

  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => shell.current?.style.setProperty("--meeting-toolbar-height", `${Math.ceil(element.getBoundingClientRect().height)}px`);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [meetingId]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLElement>("button, a, input")?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setSidebarOpen(false); setMenuOpen(false); }
      if (event.key !== "Tab") return;
      const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled)") ?? []).filter((element) => element.getClientRects().length > 0);
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!sidebarRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      sidebarTrigger.current?.focus();
    };
  }, [sidebarOpen]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user?.full_name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "BB";

  const avatarEl = user?.avatar_url
    ? <img src={user.avatar_url} alt="" className="person-avatar-img" referrerPolicy="no-referrer" />
    : <span className="person-avatar">{initials}</span>;

  const meetingNav: Array<[string, IconName, string]> = meetingId ? [
    [`/meetings/${meetingId}`, "transcript", "Bản ghi"],
    [`/meetings/${meetingId}/summary`, "summary", "Tóm tắt"],
    [`/meetings/${meetingId}/speakers`, "speaker", "Người nói"],
    [`/meetings/${meetingId}/translation`, "translate", "Bản dịch"],
    [`/meetings/${meetingId}/export-share`, "export", "Xuất"],
  ] : [];

  return <MeetingToolbarContext.Provider value={recordingHost}><WorkspaceHeaderContext.Provider value={headerHost}><div ref={shell} className={`shell ${meetingId ? "meeting-workspace" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}${recordingPage ? " recording-workspace" : ""}`}>
    {sidebarOpen && <button className="sidebar-scrim" type="button" tabIndex={-1} aria-label="Đóng lịch sử cuộc họp" onClick={() => setSidebarOpen(false)} />}
    <aside id="meeting-sidebar" ref={sidebarRef} hidden={!sidebarVisible} className={`sidebar meeting-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="Lịch sử và tài khoản" role={sidebarOpen ? "dialog" : undefined} aria-modal={sidebarOpen ? true : undefined}>
      <button className="sidebar-close workspace-icon-button" type="button" aria-label="Đóng lịch sử cuộc họp" onClick={() => setSidebarOpen(false)}><Icon name="close" /></button>
      <a className="brand" href="/meetings" aria-label="Bóc Băng">
        <span className="brand-mark"><Icon name="brand" /></span>
        <strong>Bóc Băng</strong>
      </a>

      <div className="sidebar-create-actions">
        <a className="btn btn-dark side-create" href="/meetings/create"><Icon name="plus" /><span>Cuộc họp mới</span></a>
        <a className="btn btn-light side-create" href="/meetings/create?mode=upload"><Icon name="upload" /><span>Tải bản ghi</span></a>
      </div>

      <MeetingHistory activeMeetingId={meetingId} />

      <div className="account" ref={menuRef}>
        {menuOpen && (
          <div className="account-popup">
            <div className="account-popup-header">
              {avatarEl}
              <div>
                <strong>{user?.full_name}</strong>
              </div>
            </div>
            <div className="account-popup-divider"></div>
            <button className="account-popup-item" type="button" onClick={() => { setProfileModal(true); setMenuOpen(false); setSidebarOpen(false); }}>
              <Icon name="edit-profile" />
              <span>Thay đổi thông tin</span>
            </button>
            <button className="account-popup-item" type="button" onClick={() => { setPasswordModal(true); setMenuOpen(false); setSidebarOpen(false); }}>
              <Icon name="lock" />
              <span>{user?.has_password === false ? "Tạo mật khẩu" : "Đổi mật khẩu"}</span>
            </button>
            <div className="account-popup-divider"></div>
            <a className="account-popup-item" href="/voice-profiles"><Icon name="speaker" /><span>Mẫu giọng</span></a>
            <a className="account-popup-item" href="/settings"><Icon name="settings" /><span>Cài đặt</span></a>
            <div className="account-popup-divider"></div>
            <button className="account-popup-item text-danger" type="button" onClick={() => void logout()}>
              <Icon name="logout" />
              <span>Đăng xuất</span>
            </button>
          </div>
        )}
        <button 
          className={`account-profile ${menuOpen ? 'active' : ''}`} 
          type="button" 
          aria-expanded={menuOpen}
          aria-label={`Tài khoản ${user?.full_name ?? ""}`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {avatarEl}
          <span className="account-profile-info">
            <strong>{user?.full_name}</strong>
          </span>
          <span className="account-profile-chevron">
            <Icon name="chevron-up" />
          </span>
        </button>
      </div>
    </aside>

    <main inert={sidebarOpen}>
      <header className="workspace-header">
        <button ref={sidebarTrigger} type="button" className="workspace-icon-button sidebar-toggle" title={sidebarVisible ? "Thu gọn thanh bên" : "Mở thanh bên"} aria-label={sidebarVisible ? "Thu gọn thanh bên" : "Mở thanh bên"} aria-expanded={sidebarVisible} aria-controls="meeting-sidebar" onClick={toggleSidebar}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        </button>
        <div ref={setHeaderHost} className="workspace-header-slot" />
        {!recordingPage && <a className="workspace-header-brand" href="/meetings">Bóc Băng</a>}
      </header>
      <div className="content">{children}</div>
      {meetingNav.length > 0 && (
        <div ref={toolbar} className="meeting-toolbar">
          <div ref={setRecordingHost} className="recording-toolbar-slot" />
        <nav className="meeting-tool-nav" aria-label="Công cụ cuộc họp">
          {meetingId && <MeetingPlaybackTool key={`playback-${meetingId}`} meetingId={meetingId} />}
          {meetingNav.map(([href, icon, label], index) => (
            <Fragment key={href}>
              <ToolbarTooltip label={label}><a
                className={path === href ? "selected" : ""}
                href={href}
                aria-label={label}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon name={icon} />
              </a></ToolbarTooltip>
              {index === 0 && <ToolbarTooltip label="Quản lý phiên họp"><button type="button" aria-label="Phiên họp" className={sectionsOpen ? "selected" : ""} aria-haspopup="dialog" aria-expanded={sectionsOpen} aria-controls={sectionsOpen ? "meeting-sections-dialog" : undefined} onClick={() => setSectionsOpen(true)}>
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M9 3v18" /></svg>
              </button></ToolbarTooltip>}
              {index === 0 && meetingId && <TranscriptPolishTool key={meetingId} meetingId={meetingId} />}
            </Fragment>
          ))}
        </nav>
        </div>
      )}
    </main>

    {profileModal && <ProfileModal close={() => setProfileModal(false)} user={user} updateProfile={updateProfile} />}
    {passwordModal && <PasswordModal close={() => setPasswordModal(false)} updatePassword={updatePassword} hasPassword={user?.has_password !== false} />}
    {sectionsOpen && meetingId && <MeetingSectionsDialog key={meetingId} meetingId={meetingId} close={() => setSectionsOpen(false)} />}
  </div></WorkspaceHeaderContext.Provider></MeetingToolbarContext.Provider>;
}

function ProfileModal({ close, user, updateProfile }: { close: () => void, user: any, updateProfile: (name: string) => Promise<void> }) {
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!fullName.trim()) return setError("Họ và tên không được để trống.");
    setSaving(true);
    setError("");
    try {
      await updateProfile(fullName.trim());
      close();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" style={{ width: 400 }}>
        <button className="close" aria-label="Đóng" onClick={close}><Icon name="close" /></button>
        <h2>Thay đổi thông tin</h2>
        <p>Cập nhật họ và tên hiển thị của bạn.</p>
        <div className="compact-form" style={{ marginTop: 24 }}>
          <label className="field full">
            Họ và tên
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nhập họ và tên" />
          </label>
          <label className="field full">
            Email
            <input value={user?.email ?? ""} readOnly disabled />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions" style={{ marginTop: 24 }}>
            <Button className="btn-ghost" onClick={close}>Hủy</Button>
            <Button tone="dark" disabled={saving || fullName.trim() === user?.full_name} onClick={() => void save()}>
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
