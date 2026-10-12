import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { voiceProfilesApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { PasswordModal } from "../components/PasswordModal";
import { VoiceEnrollmentModal } from "../components/VoiceEnrollmentModal";
import { Button, Icon, PageHeading } from "../components/ui";

export function SettingsPage() {
  const { user, logout, updateProfile, updatePassword } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [enrollModal, setEnrollModal] = useState(false);
  const [deletingVoice, setDeletingVoice] = useState(false);

  const voiceProfile = useAsync(async () => {
    try {
      return await voiceProfilesApi.getMyProfile();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => setFullName(user?.full_name ?? ""), [user?.full_name]);

  async function save() {
    if (!fullName.trim()) return setMessage("Họ và tên không được để trống.");
    setSaving(true);
    setMessage("");
    try {
      await updateProfile(fullName.trim());
      setMessage("Đã cập nhật hồ sơ thành công.");
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteVoice() {
    if (!window.confirm("Bạn có chắc chắn muốn xóa mẫu giọng nói cá nhân không?")) return;
    setDeletingVoice(true);
    try {
      await voiceProfilesApi.deleteMyProfile();
      await voiceProfile.reload();
      setMessage("Đã xóa mẫu giọng nói cá nhân thành công.");
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setDeletingVoice(false);
    }
  }

  return <>
    <PageHeading 
      eyebrow="TÀI KHOẢN" 
      title="Cài đặt" 
      description="Quản lý thông tin cá nhân, mẫu giọng nói nhận diện và bảo mật tài khoản." 
    />
    
    <div className="settings-container">
      {message && <div className={message.includes("thành công") ? "notice" : "form-error"}>{message}</div>}

      <h3 className="settings-group-title">Thông tin cá nhân</h3>
      <div className="setting-card">
        <div className="setting-row">
          <div className="setting-icon"><Icon name="profile" /></div>
          <div className="setting-content">
            <strong>Họ và tên</strong>
            <small>Tên hiển thị trên hệ thống và các cuộc họp.</small>
          </div>
          <div className="setting-action">
            <input
              className="setting-input"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Nhập họ và tên"
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-icon"><Icon name="translate" /></div>
          <div className="setting-content">
            <strong>Email</strong>
            <small>Địa chỉ email dùng để đăng nhập và nhận thông báo.</small>
          </div>
          <div className="setting-action">
            <input className="setting-input" value={user?.email ?? ""} readOnly disabled />
          </div>
        </div>
        <div className="setting-row" style={{ justifyContent: "flex-end", borderBottom: "none" }}>
           <Button tone="dark" disabled={saving || fullName.trim() === user?.full_name} onClick={() => void save()}>
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
           </Button>
        </div>
      </div>

      <h3 className="settings-group-title">Mẫu giọng nói nhận diện (Voice Profile)</h3>
      <div className="setting-card">
        <div className="setting-row">
          <div className="setting-icon"><Icon name="speaker" /></div>
          <div className="setting-content">
            <strong>Mẫu giọng cá nhân của tôi</strong>
            <small>
              {voiceProfile.data
                ? `Đã đăng ký (${(voiceProfile.data.sample_duration_ms / 1000).toFixed(1)}s âm thanh, qua ${voiceProfile.data.provider}). Hệ thống sẽ tự nhận diện bạn trong các cuộc họp.`
                : "Đăng ký mẫu giọng 10-25s để AI tự động nhận diện giọng nói và gán tên bạn trong mọi cuộc họp tham gia."}
            </small>
          </div>
          <div className="setting-action">
            {voiceProfile.data ? (
              <div style={{ display: "flex", gap: "8px" }}>
                <Button onClick={() => setEnrollModal(true)}>Cập nhật mẫu giọng</Button>
                <Button tone="danger" disabled={deletingVoice} onClick={() => void deleteVoice()}>
                  {deletingVoice ? "Đang xóa…" : "Xóa"}
                </Button>
              </div>
            ) : (
              <Button tone="dark" onClick={() => setEnrollModal(true)}>
                + Đăng ký mẫu giọng
              </Button>
            )}
          </div>
        </div>
      </div>

      <h3 className="settings-group-title">Bảo mật</h3>
      <div className="setting-card">
        <div className="setting-row">
          <div className="setting-icon"><Icon name="lock" /></div>
          <div className="setting-content">
            <strong>{user?.has_password === false ? "Tạo mật khẩu" : "Mật khẩu"}</strong>
            <small>{user?.has_password === false
              ? "Không bắt buộc. Tạo mật khẩu để có thể đăng nhập thêm bằng email."
              : "Thay đổi mật khẩu đăng nhập của bạn."}
            </small>
          </div>
          <div className="setting-action">
            <Button onClick={() => setPasswordModal(true)}>{user?.has_password === false ? "Tạo mật khẩu" : "Đổi mật khẩu"}</Button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-icon" style={{ color: "var(--danger)" }}><Icon name="logout" /></div>
          <div className="setting-content">
            <strong style={{ color: "var(--danger)" }}>Đăng xuất</strong>
            <small>Đăng xuất khỏi thiết bị này.</small>
          </div>
          <div className="setting-action">
            <Button tone="danger" onClick={() => void logout()}>Đăng xuất</Button>
          </div>
        </div>
      </div>
    </div>

    {passwordModal && <PasswordModal close={() => setPasswordModal(false)} updatePassword={updatePassword} hasPassword={user?.has_password !== false} />}
    {enrollModal && (
      <VoiceEnrollmentModal
        isOpen={enrollModal}
        defaultName={user?.full_name ?? ""}
        onClose={() => setEnrollModal(false)}
        onEnrolled={async (profile) => {
          await voiceProfile.reload();
          setEnrollModal(false);
          setMessage(`Đã cập nhật mẫu giọng nói cá nhân (${(profile.sample_duration_ms / 1000).toFixed(1)}s).`);
        }}
      />
    )}
  </>;
}
