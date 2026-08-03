import { FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, fileUrl } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

const MAX_AVATAR_MB = 3;

const ACCESS_LABEL: Record<string, string> = {
  FULL_ACCESS: "Full Access",
  INPUT: "Input",
  VIEW: "View",
};

type SettingsTab = "profile" | "password";

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("profile");
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <button
          type="button"
          className={"settings-nav-item" + (tab === "profile" ? " active" : "")}
          onClick={() => setTab("profile")}
        >
          <span className="settings-nav-icon">👤</span> Profil
        </button>
        <button
          type="button"
          className={"settings-nav-item" + (tab === "password" ? " active" : "")}
          onClick={() => setTab("password")}
        >
          <span className="settings-nav-icon">🔒</span> Ubah Password
        </button>
        <div className="settings-nav-divider" />
        <button type="button" className="settings-nav-item settings-nav-danger" onClick={handleLogout}>
          <span className="settings-nav-icon">🚪</span> Logout
        </button>
      </aside>
      <div className="settings-content">{tab === "profile" ? <ProfileSection /> : <PasswordSection />}</div>
    </div>
  );
}

function ProfileSection() {
  const { user, updateAvatar } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const initials = (user?.name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Avatar harus berupa file gambar (JPG/PNG/WebP).");
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setError(`Ukuran file maksimal ${MAX_AVATAR_MB}MB.`);
      return;
    }
    const formData = new FormData();
    formData.append("avatar", file);
    setUploading(true);
    try {
      const res = await api.post<{ success: boolean; avatarPath: string }>("/auth/avatar", formData);
      updateAvatar(res.avatarPath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengunggah foto avatar.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <h2 className="settings-card-title">Profil Akun</h2>
          <p className="settings-card-subtitle">Informasi akun Anda saat ini</p>
        </div>
      </div>
      <div className="settings-card-body">
        <div className="settings-avatar-row">
          <div className="settings-avatar-wrap">
            {user?.avatarPath ? (
              <img src={fileUrl(user.avatarPath)} alt="Avatar" className="settings-avatar-circle settings-avatar-img" />
            ) : (
              <div className="settings-avatar-circle">{initials}</div>
            )}
            <button
              type="button"
              className="settings-avatar-edit-btn"
              title="Ganti foto avatar"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              📷
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div>
            <div className="font-semibold text-slate-800">{user?.name}</div>
            <div className="text-sm text-slate-400">{user?.department}</div>
            {uploading && <div className="text-xs text-indigo-500">Mengunggah foto...</div>}
            {error && <p className="error-text mt-1">{error}</p>}
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label>Nama</label>
            <input value={user?.name ?? ""} readOnly />
          </div>
          <div className="field">
            <label>NIK</label>
            <input value={user?.nik ?? ""} readOnly />
          </div>
          <div className="field">
            <label>Departemen</label>
            <input value={user?.department ?? ""} readOnly />
          </div>
          <div className="field">
            <label>Hak Akses</label>
            <input value={ACCESS_LABEL[user?.access ?? "INPUT"]} readOnly />
          </div>
        </div>
        <p className="settings-hint">Untuk mengubah data profil ini, hubungi Admin (menu User Management).</p>
      </div>
    </div>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password baru tidak cocok.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setSuccess("Password berhasil diperbarui.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengubah password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <h2 className="settings-card-title">Ubah Password</h2>
          <p className="settings-card-subtitle">Buat password baru untuk akun Anda</p>
        </div>
      </div>
      <div className="settings-card-body">
        <form onSubmit={handleSubmit} className="max-w-md">
          <div className="field mb-3.5">
            <label>Password Saat Ini</label>
            <input
              type="password"
              placeholder="Masukkan password saat ini"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="field mb-3.5">
            <label>Password Baru (min. 8 karakter)</label>
            <input
              type="password"
              placeholder="Masukkan password baru"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="field mb-3.5">
            <label>Konfirmasi Password Baru</label>
            <input
              type="password"
              placeholder="Ulangi password baru"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}
          {success && <p className="status-text">{success}</p>}

          <button className="btn rounded-full px-6" type="submit" disabled={submitting}>
            {submitting ? "Menyimpan..." : "Simpan Password Baru"}
          </button>
        </form>
      </div>
    </div>
  );
}
