import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../api/client";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [nik, setNik] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, location.state]);

  useEffect(() => {
    const nikTrimmed = nik.trim();
    if (!nikTrimmed) {
      setName("");
      return;
    }
    const timeout = setTimeout(() => {
      api
        .get<{ success: boolean; name?: string }>(`/auth/lookup/${encodeURIComponent(nikTrimmed)}`)
        .then((res) => setName(res.success ? res.name ?? "" : ""))
        .catch(() => setName(""));
    }, 350);
    return () => clearTimeout(timeout);
  }, [nik]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(nik.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Websiteapp NPI</h1>
        <p className="subtitle">Masuk dengan NIK dan password Anda.</p>

        <div className="field">
          <label htmlFor="nik">NIK</label>
          <input id="nik" value={nik} onChange={(e) => setNik(e.target.value)} autoFocus required />
        </div>

        <div className="field">
          <label>Nama Karyawan</label>
          <input value={name} readOnly placeholder="(otomatis terisi)" />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? "Memproses..." : "LOGIN"}
        </button>
      </form>
    </div>
  );
}
