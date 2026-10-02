import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Button, PageHeading, Panel } from "../components/ui";

export function SettingsPage() {
  const { user, logout, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? ""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => setFullName(user?.full_name ?? ""), [user?.full_name]);
  const initials = user?.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "BB";
  async function save() { if (!fullName.trim()) return setMessage("Họ và tên không được để trống."); setSaving(true); try { await updateProfile(fullName.trim()); setMessage("Đã cập nhật hồ sơ."); } catch (cause) { setMessage((cause as Error).message); } finally { setSaving(false); } }
  return <><PageHeading eyebrow="CÀI ĐẶT & TÀI KHOẢN" title="Hồ sơ cá nhân" description="Thông tin tài khoản và các tuỳ chọn mà API hiện hỗ trợ." />
    <div className="settings-grid"><Panel><div className="profile-intro"><span className="person-avatar">{initials}</span><div><h2>{user?.full_name}</h2><p>{user?.is_email_verified ? "Tài khoản đã xác minh" : "Tài khoản chưa xác minh"}</p></div></div><div className="field-grid"><label className="field">Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label className="field">Email<input value={user?.email ?? ""} readOnly /></label></div>{message && <div className={message === "Đã cập nhật hồ sơ." ? "notice" : "form-error"}>{message}</div>}<div className="form-actions"><Button tone="dark" disabled={saving || fullName.trim() === user?.full_name} onClick={() => void save()}>{saving ? "Đang lưu…" : "✓ Cập nhật hồ sơ"}</Button></div></Panel>
      <Panel><h2>Tài khoản</h2><div className="setting-line"><div><strong>Đổi mật khẩu</strong><small>Sử dụng luồng khôi phục mật khẩu ở màn đăng nhập.</small></div></div><a className="btn btn-light" href="/">▣ Xem màn đăng nhập</a><Button tone="danger" onClick={() => void logout()}>Đăng xuất</Button><p className="settings-note">Ngôn ngữ nhận diện mặc định, diarization, số điện thoại và dung lượng lưu trữ chưa có contract API. Không hiển thị các trường giả lập.</p></Panel></div>
  </>;
}
