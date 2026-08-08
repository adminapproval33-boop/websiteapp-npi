import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, clearSession, loadSession, saveSession, StoredSession } from "../api/client";

/** Interval polling `/auth/me` (ms) selagi login -- dipakai supaya kalau sesi
 * ini diakhiri paksa dari perangkat lain (lihat AuthContext.login `force`),
 * user di sini otomatis ke-logout dlm hitungan detik, bukan cuma nunggu
 * request lain kebetulan gagal (2026-08-08, instruksi eksplisit user: 1 NIK
 * cuma 1 sesi aktif, spt SAP). */
const SESSION_POLL_MS = 20_000;

interface AuthContextValue {
  user: StoredSession | null;
  loading: boolean;
  /** `force=true` dikirim SETELAH user mengonfirmasi mau mengakhiri sesi lain
   * (lihat LoginPage) -- tanpa itu, login dgn NIK yg masih py sesi aktif di
   * tempat lain akan gagal dgn ApiError status 409. */
  login: (nik: string, password: string, force?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  markPasswordResetDone: () => void;
  updateAvatar: (avatarPath: string | null) => void;
  /** Pesan sekali-tampil kalau sesi ini baru saja ke-logout otomatis (mis.
   * diakhiri paksa krn login di perangkat lain) -- dibaca oleh LoginPage lalu
   * dikosongkan lagi (consume-once) supaya tidak muncul berulang. */
  forcedLogoutMessage: string | null;
  clearForcedLogoutMessage: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [forcedLogoutMessage, setForcedLogoutMessage] = useState<string | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  const clearForcedLogoutMessage = useCallback(() => setForcedLogoutMessage(null), []);

  // Poll /auth/me selagi login -- ini yg bikin sesi ini otomatis ke-logout
  // begitu diakhiri paksa dari perangkat lain, tanpa nunggu user klik apa pun
  // di sini dulu (lihat SESSION_POLL_MS di atas).
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      api.get<{ success: boolean }>("/auth/me").catch((err) => {
        if (!userRef.current) return;
        clearSession();
        setUser(null);
        setForcedLogoutMessage(err instanceof ApiError ? err.message : "Sesi Anda telah berakhir. Silakan login ulang.");
      });
    }, SESSION_POLL_MS);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const stored = loadSession();
    if (!stored) {
      setLoading(false);
      return;
    }
    api
      .get<{ success: boolean } & Omit<StoredSession, "token">>("/auth/me")
      .then((res) => {
        setUser({ ...stored, ...res });
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (nik: string, password: string, force = false) => {
    const res = await api.post<{ success: boolean } & StoredSession>("/auth/login", { nik, password, force });
    const session: StoredSession = {
      token: res.token,
      nik: res.nik,
      name: res.name,
      department: res.department,
      access: res.access,
      hiddenMenus: res.hiddenMenus,
      viewOnlyMenus: res.viewOnlyMenus,
      mustResetPassword: res.mustResetPassword,
      avatarPath: res.avatarPath,
    };
    saveSession(session);
    setUser(session);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const markPasswordResetDone = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, mustResetPassword: false };
      saveSession(next);
      return next;
    });
  }, []);

  const updateAvatar = useCallback((avatarPath: string | null) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, avatarPath };
      saveSession(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, markPasswordResetDone, updateAvatar, forcedLogoutMessage, clearForcedLogoutMessage }),
    [user, loading, login, logout, markPasswordResetDone, updateAvatar, forcedLogoutMessage, clearForcedLogoutMessage]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>.");
  return ctx;
}
