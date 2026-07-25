import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearSession, loadSession, saveSession, StoredSession } from "../api/client";

interface AuthContextValue {
  user: StoredSession | null;
  loading: boolean;
  login: (nik: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  markPasswordResetDone: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);

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

  const login = useCallback(async (nik: string, password: string) => {
    const res = await api.post<{ success: boolean } & StoredSession>("/auth/login", { nik, password });
    const session: StoredSession = {
      token: res.token,
      nik: res.nik,
      name: res.name,
      department: res.department,
      access: res.access,
      mustResetPassword: res.mustResetPassword,
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

  const value = useMemo(
    () => ({ user, loading, login, logout, markPasswordResetDone }),
    [user, loading, login, logout, markPasswordResetDone]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>.");
  return ctx;
}
