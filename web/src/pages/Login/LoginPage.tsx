import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../api/client";

export default function LoginPage() {
  const { user, login, forcedLogoutMessage, clearForcedLogoutMessage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [nik, setNik] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  /** Terisi kalau NIK ini masih py sesi aktif di perangkat/browser lain (409
   * dari POST /auth/login) -- ganti tombol Login biasa dgn konfirmasi
   * Lanjutkan/Batal (2026-08-08, instruksi eksplisit user: 1 NIK cuma 1 sesi
   * aktif, spt SAP, tapi user KEDUA harus diberi tahu dulu supaya bisa
   * koordinasi, bukan langsung nendang diam-diam). */
  const [conflictMessage, setConflictMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Pesan sekali-tampil kalau SESI INI SENDIRI baru saja ke-logout otomatis
   * (mis. ada yg login pakai NIK yg sama di tempat lain) -- disalin dari
   * AuthContext.forcedLogoutMessage lalu context-nya langsung dikosongkan
   * (consume-once), supaya banner ini tidak muncul lagi di kunjungan berikutnya. */
  const [loggedOutNotice, setLoggedOutNotice] = useState("");

  useEffect(() => {
    if (forcedLogoutMessage) {
      setLoggedOutNotice(forcedLogoutMessage);
      clearForcedLogoutMessage();
    }
  }, [forcedLogoutMessage, clearForcedLogoutMessage]);

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
    setConflictMessage("");
    setSubmitting(true);
    try {
      await login(nik.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Login gagal.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForceLogin() {
    setError("");
    setSubmitting(true);
    try {
      await login(nik.trim(), password, true);
      setConflictMessage("");
    } catch (err) {
      setConflictMessage("");
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

        {loggedOutNotice && <p className="status-text">{loggedOutNotice}</p>}

        <div className="field">
          <label htmlFor="nik">NIK</label>
          <input
            id="nik"
            value={nik}
            onChange={(e) => {
              setNik(e.target.value);
              setConflictMessage("");
            }}
            autoFocus
            required
          />
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
            onChange={(e) => {
              setPassword(e.target.value);
              setConflictMessage("");
            }}
            required
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        {conflictMessage ? (
          <div className="field" style={{ gap: 8, display: "flex", flexDirection: "column" }}>
            <p className="error-text" style={{ margin: 0 }}>
              {conflictMessage}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" type="button" disabled={submitting} onClick={handleForceLogin}>
                {submitting ? "Memproses..." : "Lanjutkan Login"}
              </button>
              <button
                className="btn btn-outline"
                type="button"
                disabled={submitting}
                onClick={() => setConflictMessage("")}
              >
                Batal
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? "Memproses..." : "LOGIN"}
          </button>
        )}
      </form>
    </div>
  );
}
