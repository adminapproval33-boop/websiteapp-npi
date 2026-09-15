import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fileUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getStoredLanguage, setStoredLanguage, AppLanguage } from "../i18n";

const ACCESS_LABEL: Record<string, string> = {
  FULL_ACCESS: "Full Access",
  INPUT: "Input",
  VIEW: "View",
};

/** Tombol toggle bahasa Indonesia/Inggris (2026-09-15, instruksi eksplisit
 * user: bisa translate semua bahasa di website sesuai kemauan user) --
 * ditaruh di Topbar krn selalu terpasang di semua halaman (lihat
 * AppLayout.tsx), sama pola dgn tombol "Pengaturan" di sebelahnya. Pilihan
 * bahasa disimpan di localStorage (lihat i18n/index.ts) supaya tidak reset
 * tiap buka halaman/refresh. */
function LanguageToggle() {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<AppLanguage>(getStoredLanguage());

  function toggle() {
    const next: AppLanguage = lang === "id" ? "en" : "id";
    setLang(next);
    setStoredLanguage(next);
    i18n.changeLanguage(next);
  }

  return (
    <button className="btn topbar-settings-btn" type="button" onClick={toggle} title="Ganti Bahasa / Change Language">
      🌐 {lang === "id" ? "ID" : "EN"}
    </button>
  );
}

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Ganti `key` div logo tiap 15 menit (2026-08-29, permintaan eksplisit
   * user) supaya React unmount+remount elemennya -- ini yang bikin animasi
   * CSS logoIconReveal/logoTextReveal (yg didesain sekali-jalan pas mount,
   * lihat app.css) terputar ulang secara berkala, bukan cuma sekali pas
   * topbar pertama muncul. */
  const [logoAnimKey, setLogoAnimKey] = useState(0);
  useEffect(() => {
    const REPLAY_INTERVAL_MS = 15 * 60 * 1000;
    const id = setInterval(() => setLogoAnimKey((k) => k + 1), REPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="topbar">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={t("Buka menu")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-white hover:bg-white/10 lg:hidden"
        >
          ☰
        </button>
        <div className="topbar-logo" key={logoAnimKey}>
          <img src="/brand-logo-icon.png" alt="" aria-hidden="true" className="topbar-logo-icon" />
          <img src="/brand-logo-text.png" alt="Websiteapp Npi" className="topbar-logo-text" />
        </div>
      </div>
      <div className="topbar-right">
        <span className="hidden sm:inline">{now.toLocaleString(i18n.language === "en" ? "en-US" : "id-ID")}</span>

        <div className="topbar-user-card">
          {user?.avatarPath ? (
            <img
              src={fileUrl(user.avatarPath)}
              alt="Avatar"
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-700">
              {initials}
            </div>
          )}
          <div className="topbar-user">
            <span className="font-semibold text-slate-700">{user?.name}</span>
            <span className="access-badge">
              NIK {user?.nik} · {ACCESS_LABEL[user?.access ?? "INPUT"]}
            </span>
          </div>
        </div>

        <LanguageToggle />

        <button className="btn topbar-settings-btn" onClick={() => navigate("/settings")} title={t("Pengaturan")}>
          ⚙️ {t("Pengaturan")}
        </button>
      </div>
    </header>
  );
}
