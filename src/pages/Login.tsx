import { useRef, useState } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { supabase } from "../lib/supabase";

const SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY as string;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!captchaToken) {
      setErr("Vui lòng xác minh captcha");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    if (error) {
      setErr(error.message);
      // token chỉ dùng được 1 lần -> reset để lấy token mới
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Memento Admin</h1>
        <p className="sub">Đăng nhập bằng tài khoản có role admin</p>
        {err && <div className="err">{err}</div>}
        <input type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <input type="password" placeholder="Mật khẩu" value={password}
          onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />

        <div style={{ margin: "12px 0" }}>
          <HCaptcha
            ref={captchaRef}
            sitekey={SITE_KEY}
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
            onError={() => setCaptchaToken(null)}
          />
        </div>

        <button className="btn btn-primary" style={{ width: "100%" }}
          disabled={busy || !captchaToken}>
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
