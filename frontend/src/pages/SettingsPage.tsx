import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { voiceProfilesApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { Button, PageHeading, Panel } from "../components/ui";
import { VoiceEnrollmentModal } from "../components/VoiceEnrollmentModal";

export function SettingsPage() {
  const { user, logout, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [deletingVoice, setDeletingVoice] = useState(false);

  const voiceProfile = useAsync(async () => {
    try {
      return await voiceProfilesApi.getMyProfile();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => setFullName(user?.full_name ?? ""), [user?.full_name]);
  const initials = user?.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "BB";

  async function save() {
    if (!fullName.trim()) return setMessage("Họ và tên không được để trống.");
    setSaving(true);
    try {
      await updateProfile(fullName.trim());
      setMessage("Đã cập nhật hồ sơ.");
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteVoice() {
    setDeletingVoice(true);
    try {
      await voiceProfilesApi.deleteMyProfile();
      await voiceProfile.reload();
      setMessage("Đã xóa mẫu giọng nói cá nhân.");
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setDeletingVoice(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="CÀI ĐẶT & TÀI KHOẢN"
        title="Hồ sơ cá nhân"
        description="Thông tin tài khoản, mẫu giọng nói nhận diện và các tuỳ chọn hỗ trợ."
      />
      <div className="settings-grid">
        <div style={{ display: "grid", gap: "24px" }}>
          <Panel>
            <div className="profile-intro">
              <span className="person-avatar">{initials}</span>
              <div>
                <h2>{user?.full_name}</h2>
                <p>{user?.is_email_verified ? "Tài khoản đã xác minh" : "Tài khoản chưa xác minh"}</p>
              </div>
            </div>
            <div className="field-grid">
              <label className="field">
                Họ và tên
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </label>
              <label className="field">
                Email
                <input value={user?.email ?? ""} readOnly />
              </label>
            </div>
            {message && (
              <div className={message === "Đã cập nhật hồ sơ." || message.startsWith("Đã") ? "notice" : "form-error"}>
                {message}
              </div>
            )}
            <div className="form-actions">
              <Button tone="dark" disabled={saving || fullName.trim() === user?.full_name} onClick={() => void save()}>
                {saving ? "Đang lưu…" : "✓ Cập nhật hồ sơ"}
              </Button>
            </div>
          </Panel>

          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "17px", fontWeight: "700", color: "#10213d", margin: 0 }}>
                  🎙️ Mẫu giọng nói của tôi (Voice Profile)
                </h2>
                <p style={{ margin: "5px 0 0", color: "#667a9a", fontSize: "13px" }}>
                  Mẫu giọng cá nhân giúp hệ thống tự động nhận diện và gán tên bạn trong mọi cuộc họp bạn tham gia.
                </p>
              </div>
              {voiceProfile.data && (
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: "600",
                    backgroundColor: "#eaf9f1",
                    color: "#087b54",
                    border: "1px solid #bdebd2",
                    padding: "3px 9px",
                    borderRadius: "999px",
                    whiteSpace: "nowrap",
                  }}
                >
                  ✓ Đã đăng ký
                </span>
              )}
            </div>

            {voiceProfile.loading ? (
              <p style={{ color: "#8095b2", fontSize: "13px" }}>Đang kiểm tra dữ liệu mẫu giọng...</p>
            ) : voiceProfile.data ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    padding: "14px 16px",
                    backgroundColor: "#f9fbfe",
                    borderRadius: "8px",
                    border: "1px solid #d9e2ee",
                    marginBottom: "16px",
                  }}
                >
                  <span
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "50%",
                      backgroundColor: "#eaf9f1",
                      color: "#087b54",
                      display: "grid",
                      placeItems: "center",
                      fontSize: "20px",
                      flex: "none",
                    }}
                  >
                    🔊
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: "14px", color: "#10213d", display: "block" }}>
                      {voiceProfile.data.name}
                    </strong>
                    <div style={{ display: "flex", gap: "14px", marginTop: "4px", color: "#667a9a", fontSize: "12px", flexWrap: "wrap" }}>
                      <span>
                        Thời lượng mẫu: <strong>{Math.max(1, Math.round(voiceProfile.data.sample_duration_ms / 1000))} giây</strong>
                      </span>
                      <span>
                        Đăng ký: {new Date(voiceProfile.data.created_at).toLocaleDateString("vi-VN")}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <Button onClick={() => setEnrollOpen(true)}>
                    Thu âm lại / Cập nhật mẫu giọng
                  </Button>
                  <Button tone="danger" disabled={deletingVoice} onClick={() => void deleteVoice()}>
                    {deletingVoice ? "Đang xóa..." : "Xóa mẫu giọng"}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "20px",
                  backgroundColor: "#fbfcfe",
                  border: "1px dashed #d9e2ee",
                  borderRadius: "8px",
                  textAlign: "center",
                }}
              >
                <p style={{ color: "#667a9a", margin: "0 0 16px", fontSize: "13px" }}>
                  Bạn chưa đăng ký mẫu giọng cá nhân. Hãy thu âm từ 10 - 25 giây để hệ thống nhận diện chính xác giọng nói của bạn khi phát biểu trong các phiên họp.
                </p>
                <Button tone="dark" onClick={() => setEnrollOpen(true)}>
                  + Đăng ký mẫu giọng nói ngay
                </Button>
              </div>
            )}
          </Panel>
        </div>

        <Panel>
          <h2>Tài khoản</h2>
          <div className="setting-line">
            <div>
              <strong>Đổi mật khẩu</strong>
              <small>Sử dụng luồng khôi phục mật khẩu ở màn đăng nhập.</small>
            </div>
          </div>
          <a className="btn btn-light" href="/">
            ▣ Xem màn đăng nhập
          </a>
          <Button tone="danger" onClick={() => void logout()}>
            Đăng xuất
          </Button>
          <p className="settings-note">
            Ngôn ngữ nhận diện mặc định, diarization, số điện thoại và dung lượng lưu trữ chưa có contract API. Không hiển thị các trường giả lập.
          </p>
        </Panel>
      </div>

      {enrollOpen && (
        <VoiceEnrollmentModal
          isOpen={enrollOpen}
          defaultName={user?.full_name}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={() => {
            void voiceProfile.reload();
            setMessage("Đã cập nhật mẫu giọng nói cá nhân thành công.");
          }}
        />
      )}
    </>
  );
}
