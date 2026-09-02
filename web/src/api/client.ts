const SESSION_KEY = "npi_session";

/** Di dev lokal kosong (pakai proxy Vite "/api"); di production diisi VITE_API_URL menunjuk ke backend Render. */
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export interface StoredSession {
  token: string;
  nik: string;
  name: string;
  department: string;
  access: "INPUT" | "VIEW" | "FULL_ACCESS";
  /** Key menu (lihat lib/menuAccess.ts di server) yg user ini TIDAK PUNYA
   * akses SAMA SEKALI -- dipakai utk sembunyikan item menu dari sidebar
   * (2026-08-03, instruksi eksplisit user). */
  hiddenMenus: string[];
  /** Key menu yg user ini cuma bisa lihat History/Queue (tab Input
   * disembunyikan di halaman terkait) -- lihat lib/menuAccess.ts. */
  viewOnlyMenus: string[];
  mustResetPassword: boolean;
  avatarPath?: string | null;
}

// Pakai localStorage (bukan sessionStorage) SENGAJA (2026-08-08, instruksi
// eksplisit user) -- supaya 1 login dibagi ke SEMUA tab di browser yang sama
// (localStorage lintas-tab, sessionStorage per-tab sendiri-sendiri). Tanpa
// ini, tiap tab baru dianggap "login baru" oleh gerbang 1-NIK-1-sesi-aktif
// (lihat AuthContext.tsx/auth.routes.ts), jadi buka tab ke-2/ke-3 selalu
// kena peringatan konflik walau fisiknya 1 orang di 1 browser yang sama.
// Konsekuensinya: sesi TETAP tersimpan walau browser ditutup-buka lagi
// (beda dari sessionStorage yg otomatis hilang) -- baru benar2 habis lewat
// Logout eksplisit, ATAU login NIK yang sama dari device lain (force-revoke,
// lihat revokeSessionsForUser/single-session gate). TIDAK ADA auto-logout
// karena idle (2026-08-11, instruksi eksplisit user) -- SESSION_TTL_MINUTES
// di server/.env sengaja dibuat sangat besar (10 tahun), bukan lagi 30 menit.
export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** URL untuk link <a href> ke file lampiran -- menyertakan token lewat query string karena link biasa tidak mengirim header Authorization. */
export function fileUrl(relativePath: string): string {
  const session = loadSession();
  return `${API_BASE}/files/${relativePath}?token=${encodeURIComponent(session?.token ?? "")}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = loadSession();
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? `Permintaan gagal (${res.status}).`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
