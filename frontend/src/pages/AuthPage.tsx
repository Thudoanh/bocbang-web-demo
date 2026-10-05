import { useState } from "react";
import { ApiError } from "../api/client";
import { authApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Button, Icon } from "../components/ui";

type Mode = "login" | "register" | "verify" | "forgot" | "reset";
export function AuthPage({ initialMode = "login" }: { initialMode?: Exclude<Mode, "verify" | "reset"> }) {
  const [mode, setMode] = useState<Mode>(initialMode); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [name, setName] = useState(""); const [agreed, setAgreed] = useState(false); const [code, setCode] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const auth = useAuth();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      if (mode === "login") { await auth.login(email, password); window.location.assign("/meetings"); }
      else if (mode === "register") { if (password !== confirmPassword) throw new Error("Mật khẩu xác nhận chưa khớp."); if (!agreed) throw new Error("Bạn cần đồng ý với điều khoản sử dụng."); await auth.register(email, password, name); setMode("verify"); }
      else if (mode === "verify") { await auth.verifyOtp(email, code); window.location.assign("/meetings"); }
      else if (mode === "forgot") { await authApi.forgotPassword(email); setMode("reset"); }
      else { await authApi.resetPassword(email, code, password); setMode("login"); }
    } catch (cause) { const apiError = cause as ApiError; if (apiError.code === "EMAIL_NOT_VERIFIED") setMode("verify"); setError(apiError.message); } finally { setPending(false); }
  }
  const copy = mode === "login" ? ["Đăng nhập", "Chào mừng bạn quay trở lại."] : mode === "register" ? ["Tạo tài khoản mới", "Bắt đầu bóc băng và tóm tắt cuộc họp thông minh."] : mode === "verify" ? ["Xác minh email", "Nhập mã OTP chúng tôi đã gửi tới email của bạn."] : mode === "forgot" ? ["Quên mật khẩu", "Nhập email để nhận mã đặt lại mật khẩu."] : ["Đặt lại mật khẩu", "Nhập mã OTP và mật khẩu mới."];
  return <div className="auth"><header><a className="brand" href="/"><span className="brand-mark"><Icon name="brand" /></span><span><strong>Bóc Băng AI</strong><small>Audio Intelligence · v2.4</small></span></a><span>Không gian làm việc an toàn</span></header><section className={`auth-card ${mode === "register" ? "auth-card-wide" : ""}`}><div className="auth-mark"><Icon name="brand" /></div><h1>{copy[0]}</h1><p>{copy[1]}</p>{mode === "register" && <button className="google" type="button" onClick={() => auth.googleLogin()}>G　Đăng ký với Google</button>}<form className={mode === "register" ? "register-form" : ""} onSubmit={submit}>
    {mode === "register" && <label>Họ và tên<input required value={name} onChange={(e) => setName(e.target.value)} /></label>}
    <label>{mode === "login" ? "Tài khoản" : "Email công việc"}<input type="email" placeholder={mode === "login" ? "Số điện thoại hoặc email" : "Email của bạn"} required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    {(mode === "verify" || mode === "reset") && <label>Mã OTP<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label>}
    {mode !== "verify" && mode !== "forgot" && <label>{mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}<input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
    {mode === "register" && <label>Xác nhận mật khẩu<input type="password" minLength={8} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>}
    {mode === "register" && <label className="auth-consent"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />Tôi đồng ý với Điều khoản dịch vụ và Chính sách bảo mật.</label>}
    {error && <div className="form-error">{error}</div>}
    <Button type="submit" tone="dark" disabled={pending}>{pending ? "Đang xử lý…" : mode === "verify" ? "Xác minh email" : mode === "forgot" ? "Gửi mã" : mode === "reset" ? "Đặt lại mật khẩu" : copy[0]}</Button>
  </form>
  {mode === "login" && <><button className="google" onClick={() => auth.googleLogin()}>G Đăng nhập bằng Google</button><p className="switch">Chưa có tài khoản? <a href="/register">Đăng ký</a> · <a href="/forgot-password">Quên mật khẩu?</a></p></>}
  {mode === "register" && <p className="switch">Đã có tài khoản? <a href="/login">Đăng nhập</a></p>}
  {mode === "verify" && <p className="switch">Không nhận được mã? <button onClick={() => void authApi.resendOtp(email)}>Gửi lại</button></p>}
  {mode === "forgot" && <div className="recovery-steps"><strong>Quy trình khôi phục</strong><span>1 · Nhập email</span><span>2 · Nhận mã OTP</span><span>3 · Đổi mật khẩu</span></div>}
  {(mode === "forgot" || mode === "reset") && <p className="switch"><a href="/login">Quay lại đăng nhập</a></p>}
  </section></div>;
}
