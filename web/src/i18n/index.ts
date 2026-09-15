import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

/** Sistem terjemahan Indonesia/Inggris (2026-09-15, instruksi eksplisit
 * user: tombol toggle bahasa utk seluruh aplikasi). Bahasa Indonesia adalah
 * bahasa ASLI semua teks di kode (sebagian besar sudah begitu sejak awal
 * dibuat) -- jadi teks Indonesia ITU SENDIRI dipakai sbg "key" terjemahan
 * (lewat `t("Simpan Data")` dst, lihat lib/useT.ts), TIDAK perlu bikin nama
 * key baru terpisah utk tiap string. `resources.id` sengaja dibiarkan kosong
 * -- i18next otomatis fallback ke key mentah kalau tidak ketemu terjemahan
 * utk bahasa aktif, jadi mode Indonesia tidak perlu didaftarkan ulang satu2.
 * `resources.en` berisi terjemahan Inggris utk key (= teks Indonesia asli)
 * yg SUDAH pernah dikerjakan -- key yg belum sempat diterjemahkan otomatis
 * tetap tampil bahasa Indonesia (fallback ke key mentah) sampai giliran
 * diterjemahkan. */
const STORAGE_KEY = "npi_lang";

export type AppLanguage = "id" | "en";

export function getStoredLanguage(): AppLanguage {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "en" ? "en" : "id";
  } catch {
    return "id";
  }
}

export function setStoredLanguage(lang: AppLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* localStorage tidak tersedia (mis. private mode) -- abaikan, tetap bisa ganti bahasa utk sesi ini */
  }
}

i18n.use(initReactI18next).init({
  resources: {
    id: { translation: {} },
    en: { translation: en },
  },
  lng: getStoredLanguage(),
  fallbackLng: "id",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export default i18n;
