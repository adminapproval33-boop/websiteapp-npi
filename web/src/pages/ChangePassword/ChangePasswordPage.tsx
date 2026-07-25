import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

export default function ChangePasswordPage() {
  const { user, markPasswordResetDone } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password baru tidak cocok.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      markPasswordResetDone();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengubah password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Ganti Password</h1>
        <p className="subtitle">
          {user?.mustResetPassword
            ? "Akun Anda menggunakan password sementara. Silakan buat password baru sebelum melanjutkan."
            : "Perbarui password akun Anda."}
        </p>

        <div className="field">
          <label>Password Saat Ini</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password Baru (min. 8 karakter)</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </div>
        <div className="field">
          <label>Konfirmasi Password Baru</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? "Menyimpan..." : "Simpan Password Baru"}
        </button>
      </form>
    </div>
  );
}
