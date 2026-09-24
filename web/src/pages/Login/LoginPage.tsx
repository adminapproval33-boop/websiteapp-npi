import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../api/client";
import PaintGalaxyBackground from "../../components/PaintGalaxyBackground";

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

  /** Ganti `key` div logo tiap 15 menit (2026-08-29, permintaan eksplisit
   * user) supaya React unmount+remount elemennya -- ini yang bikin animasi
   * CSS logoIconReveal/logoTextReveal (yg didesain sekali-jalan pas mount,
   * lihat app.css) terputar ulang secara berkala, bukan cuma sekali pas
   * halaman login pertama dibuka. */
  const [logoAnimKey, setLogoAnimKey] = useState(0);
  useEffect(() => {
    const REPLAY_INTERVAL_MS = 15 * 60 * 1000;
    const id = setInterval(() => setLogoAnimKey((k) => k + 1), REPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="login-page">
      {/* Animasi galaksi cat interaktif (2026-09-23, instruksi eksplisit
          user: ganti total background login lama -- video tetesan cat +
          dekorasi molekul SVG -- dgn animasi ini). */}
      <PaintGalaxyBackground />

      {/* Kartu digeser ke kanan lewat wrapper ini (2026-09-23, keluhan
          eksplisit user: kartu yg dulu persis di tengah layar "mengganggu"
          krn menutupi pas titik pusat animasi galaksi) -- lihat .login-shift
          di app.css. */}
      <div className="login-shift">
        <div className="login-card-wrap">
          <form className="login-card" onSubmit={handleSubmit}>
            <div className="login-card-header">
              <div className="login-logo" key={logoAnimKey}>
                <img src="/brand-logo-icon.png" alt="" aria-hidden="true" className="login-logo-icon" />
                <img src="/brand-logo-text.png" alt="Websiteapp Npi" className="login-logo-text" />
              </div>
              <p className="welcome">Selamat Datang</p>
              <p className="subtitle">Silakan Masuk ke Akun Anda</p>
            </div>

            <div className="login-card-body">
              {loggedOutNotice && <p className="status-text">{loggedOutNotice}</p>}

              <div className="field">
                <div className="login-field">
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10 2a4 4 0 100 8 4 4 0 000-8zM3 17a7 7 0 0114 0v.5a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5V17z" />
                  </svg>
                  <label htmlFor="nik" className="sr-only">
                    NIK
                  </label>
                  <input
                    id="nik"
                    placeholder="NIK :"
                    value={nik}
                    onChange={(e) => {
                      setNik(e.target.value);
                      setConflictMessage("");
                    }}
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="field">
                <div className="login-field">
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10 2a4 4 0 100 8 4 4 0 000-8zM3 17a7 7 0 0114 0v.5a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5V17z" />
                  </svg>
                  <label className="sr-only">Nama Karyawan</label>
                  <input value={name} readOnly placeholder="NAMA KARYAWAN :" />
                </div>
              </div>

              <div className="field">
                <div className="login-field">
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5 8V6a5 5 0 0110 0v2h.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-7A1.5 1.5 0 014.5 8H5zm2 0h6V6a3 3 0 00-6 0v2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <label htmlFor="password" className="sr-only">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    placeholder="PASSWORD :"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setConflictMessage("");
                    }}
                    required
                  />
                </div>
              </div>

              <a className="login-forgot" href="mailto:teguh.agri@nipseapaint.com?subject=Lupa%20Kata%20Sandi">
                Lupa Kata Sandi?
              </a>

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
                  {submitting ? "Memproses..." : "MASUK"}
                </button>
              )}

              <p className="login-contact">
                Untuk permintaan akses silahkan hubungi email{" "}
                <a href="mailto:teguh.agri@nipseapaint.com">teguh.agri@nipseapaint.com</a>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
