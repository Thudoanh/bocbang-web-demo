import { useState } from "react";
import { ApiError } from "../api/client";
import { authApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui";

type Mode = "login" | "register" | "verify" | "forgot" | "reset";
export function AuthPage() {
  const [mode, setMode] = useState<Mode>("login"); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(""); const [code, setCode] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const auth = useAuth();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      if (mode === "login") { await auth.login(email, password); window.location.assign("/meetings"); }
      else if (mode === "register") { await auth.register(email, password, name); setMode("verify"); }
      else if (mode === "verify") { await auth.verifyOtp(email, code); window.location.assign("/meetings"); }
      else if (mode === "forgot") { await authApi.forgotPassword(email); setMode("reset"); }
      else { await authApi.resetPassword(email, code, password); setMode("login"); }
    } catch (cause) { const apiError = cause as ApiError; if (apiError.code === "EMAIL_NOT_VERIFIED") setMode("verify"); setError(apiError.message); } finally { setPending(false); }
  }
  const copy = mode === "login" ? ["Đăng nhập", "Đăng nhập để quản lý cuộc họp và bản ghi của bạn."] : mode === "register" ? ["Tạo tài khoản", "Xác minh email trước khi dùng không gian làm việc."] : mode === "verify" ? ["Xác minh email", "Nhập mã OTP chúng tôi đã gửi tới email của bạn."] : mode === "forgot" ? ["Đặt lại mật khẩu", "Nhập email để nhận mã đặt lại mật khẩu."] : ["Đặt lại mật khẩu", "Nhập mã OTP và mật khẩu mới."];
  return <div className="auth"><header><a className="brand" href="/"> <span>〰</span> Bóc Băng AI</a><span>Phiên bản demo</span></header><section className="auth-card"><div className="auth-mark">〰</div><h1>{copy[0]}</h1><p>{copy[1]}</p><form onSubmit={submit}>
    {mode === "register" && <label>Họ và tên<input required value={name} onChange={(e) => setName(e.target.value)} /></label>}
    <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    {(mode === "verify" || mode === "reset") && <label>Mã OTP<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label>}
    {mode !== "verify" && mode !== "forgot" && <label>{mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}<input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
    {error && <div className="form-error">{error}</div>}
    <Button type="submit" tone="dark" disabled={pending}>{pending ? "Đang xử lý…" : mode === "verify" ? "Xác minh email" : mode === "forgot" ? "Gửi mã" : mode === "reset" ? "Đặt lại mật khẩu" : copy[0]}</Button>
  </form>
  {mode === "login" && <><button className="google" onClick={() => auth.googleLogin()}>G Đăng nhập bằng Google</button><p className="switch">Chưa có tài khoản? <button onClick={() => setMode("register")}>Đăng ký</button> · <button onClick={() => setMode("forgot")}>Quên mật khẩu?</button></p></>}
  {mode === "register" && <p className="switch">Đã có tài khoản? <button onClick={() => setMode("login")}>Đăng nhập</button></p>}
  {mode === "verify" && <p className="switch">Không nhận được mã? <button onClick={() => void authApi.resendOtp(email)}>Gửi lại</button></p>}
  {(mode === "forgot" || mode === "reset") && <p className="switch"><button onClick={() => setMode("login")}>Quay lại đăng nhập</button></p>}
  </section></div>;
}
