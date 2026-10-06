import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, fileUrl } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

const MAX_AVATAR_MB = 3;

const ACCESS_LABEL: Record<string, string> = {
  FULL_ACCESS: "Full Access",
  INPUT: "Input",
  VIEW: "View",
};

type SettingsTab = "profile" | "notifications" | "password";

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
          className={"settings-nav-item" + (tab === "notifications" ? " active" : "")}
          onClick={() => setTab("notifications")}
        >
          <span className="settings-nav-icon">🔔</span> Notifikasi
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
      <div className="settings-content">
        {tab === "profile" ? <ProfileSection /> : tab === "notifications" ? <NotificationSection /> : <PasswordSection />}
      </div>
    </div>
  );
}

/** Pemetaan Tahap Proses -> field toggle personal, dipakai bikin 6 dropdown
 * Aktif/Nonaktif yang sama bentuknya (2026-09-30, instruksi eksplisit user;
 * direvisi 2x 2026-10-01: dropdown departemen diganti opt-in personal per
 * tahap -- "kalau user tersebut memilih untuk menyalakan notifikasi
 * Approval, maka user tersebut akan menerima email notifikasi approval").
 * "Packing" sengaja tidak ada -- di luar cakupan fitur ini. */
type NotifyStageField =
  | "notifyPremix"
  | "notifyMilling"
  | "notifyAftermix"
  | "notifyColourMatching"
  | "notifyQc"
  | "notifyApproval";

const STAGE_FIELDS: { label: string; field: NotifyStageField }[] = [
  { label: "Premix", field: "notifyPremix" },
  { label: "Milling", field: "notifyMilling" },
  { label: "Aftermix", field: "notifyAftermix" },
  { label: "Colour Matching", field: "notifyColourMatching" },
  { label: "QC", field: "notifyQc" },
  { label: "Approval", field: "notifyApproval" },
];

interface NotifyPrefsForm {
  notifyPremix: boolean;
  notifyMilling: boolean;
  notifyAftermix: boolean;
  notifyColourMatching: boolean;
  notifyQc: boolean;
  notifyApproval: boolean;
}

function NotificationSection() {
  const { user, updateOrderDelayNotif } = useAuth();
  const [form, setForm] = useState<NotifyPrefsForm>({
    notifyPremix: user?.notifyPremix ?? false,
    notifyMilling: user?.notifyMilling ?? false,
    notifyAftermix: user?.notifyAftermix ?? false,
    notifyColourMatching: user?.notifyColourMatching ?? false,
    notifyQc: user?.notifyQc ?? false,
    notifyApproval: user?.notifyApproval ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setForm({
      notifyPremix: user?.notifyPremix ?? false,
      notifyMilling: user?.notifyMilling ?? false,
      notifyAftermix: user?.notifyAftermix ?? false,
      notifyColourMatching: user?.notifyColourMatching ?? false,
      notifyQc: user?.notifyQc ?? false,
      notifyApproval: user?.notifyApproval ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.notifyPremix,
    user?.notifyMilling,
    user?.notifyAftermix,
    user?.notifyColourMatching,
    user?.notifyQc,
    user?.notifyApproval,
  ]);

  const hasEmail = Boolean(user?.email);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const res = await api.put<{ success: boolean } & NotifyPrefsForm>("/auth/me/order-delay-notif", form);
      updateOrderDelayNotif(res);
      setMessage("Preferensi notifikasi berhasil disimpan.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan preferensi notifikasi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="profile-details-panel">
        <div className="profile-details-header">Notifikasi</div>
        <div className="profile-details-body">
          <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.65)", marginBottom: 12 }}>
            Pilih tahap proses mana saja yang ingin Anda terima notifikasinya lewat email -- lepas dari departemen
            Anda. Kalau Anda aktifkan mis. "Approval", Anda akan menerima email setiap ada order yang macet di tahap
            Approval melebihi ambang Lead Time Proses (ditentukan developer/admin), order dari departemen mana pun.
          </p>
          {!hasEmail && (
            <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
              Isi email Anda dulu di tab Profil sebelum bisa mengaktifkan notifikasi ini.
            </p>
          )}
          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              {STAGE_FIELDS.map(({ label, field }) => (
                <div className="field" key={field}>
                  <label>{label}</label>
                  <select
                    value={form[field] ? "on" : "off"}
                    disabled={!hasEmail || saving}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value === "on" })}
                  >
                    <option value="on">Aktif</option>
                    <option value="off">Nonaktif</option>
                  </select>
                </div>
              ))}
            </div>
            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-success" type="submit" disabled={!hasEmail || saving}>
                Simpan Preferensi
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { user, updateAvatar, updateEmail } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(user?.email ?? "");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    setEmailDraft(user?.email ?? "");
  }, [user?.email]);

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailError("");
    setEmailSaving(true);
    try {
      const res = await api.put<{ success: boolean; email: string | null }>("/auth/me/email", { email: emailDraft.trim() });
      updateEmail(res.email);
      setEditingEmail(false);
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : "Gagal menyimpan email.");
    } finally {
      setEmailSaving(false);
    }
  }

  function handleEmailCancel() {
    setEmailDraft(user?.email ?? "");
    setEmailError("");
    setEditingEmail(false);
  }

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
    <div>
      <div className="profile-hero">
        <div className="profile-hero-avatar-wrap">
          <div className="profile-hero-avatar-ring">
            <div className="profile-hero-avatar-inner">
              {user?.avatarPath ? (
                <img src={fileUrl(user.avatarPath)} alt="Avatar" className="profile-hero-avatar-img" />
              ) : (
                initials
              )}
            </div>
          </div>
          <button
            type="button"
            className="profile-hero-avatar-edit-btn"
            title="Ganti foto avatar"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            📷
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>

        <div className="profile-hero-name-row">
          <h2 className="profile-hero-name">{user?.name}</h2>
          {user?.access === "FULL_ACCESS" && (
            <span className="profile-badge" title="Full Access">
              ✓
            </span>
          )}
        </div>
        <p className="profile-hero-email">{user?.email || "Email belum diisi"}</p>
        {uploading && <p className="profile-hero-email">Mengunggah foto...</p>}
        {error && <p className="error-text mt-1">{error}</p>}
      </div>

      <div className="profile-details-panel">
        <div className="profile-details-header">Detail Akun</div>
        <div className="profile-details-row">
          <span className="profile-details-label">Nama Lengkap</span>
          <span className="profile-details-value">{user?.name}</span>
        </div>
        <div className="profile-details-row">
          <span className="profile-details-label">NIK</span>
          <span className="profile-details-value">{user?.nik}</span>
        </div>
        <div className="profile-details-row">
          <span className="profile-details-label">Departemen</span>
          <span className="profile-details-value">{user?.department}</span>
        </div>
        <div className="profile-details-row">
          <span className="profile-details-label">Hak Akses</span>
          <span className="profile-details-value">{ACCESS_LABEL[user?.access ?? "INPUT"]}</span>
        </div>
        <div className="profile-details-row">
          <span className="profile-details-label">Email</span>
          {editingEmail ? (
            <form onSubmit={handleEmailSubmit} className="profile-email-edit-form">
              <input
                type="email"
                autoFocus
                placeholder="nama@nipseapaint.com"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
              />
              <button className="profile-email-save-btn" type="submit" disabled={emailSaving}>
                {emailSaving ? "Menyimpan..." : "Simpan"}
              </button>
              <button className="profile-email-cancel-btn" type="button" onClick={handleEmailCancel}>
                Batal
              </button>
            </form>
          ) : (
            <span className="profile-details-value-group">
              <span className="profile-details-value">{user?.email ?? "-"}</span>
              <button className="profile-edit-link" type="button" onClick={() => setEditingEmail(true)}>
                Ubah
              </button>
            </span>
          )}
        </div>
        {emailError && (
          <div className="profile-details-row">
            <p className="error-text">{emailError}</p>
          </div>
        )}
      </div>
      <p className="settings-hint">
        Nama/NIK/Departemen/Hak Akses dikelola Admin (menu User Management). Email dipakai utk notifikasi sistem
        (mis. Notifikasi Order Macet, lihat tab Notifikasi) dan akan tampil juga di menu Master Data &gt; Data
        Karyawan kolom Email.
      </p>
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
    <div className="profile-details-panel">
      <div className="profile-details-header">Ubah Password</div>
      <div className="profile-details-body">
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.65)", marginBottom: 12 }}>
          Buat password baru untuk akun Anda.
        </p>
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
