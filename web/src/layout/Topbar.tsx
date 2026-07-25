import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const ACCESS_LABEL: Record<string, string> = {
  FULL_ACCESS: "Full Access",
  INPUT: "Input",
  VIEW: "View",
};

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

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
          aria-label="Buka menu"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-slate-600 hover:bg-slate-100 lg:hidden"
        >
          ☰
        </button>
        <span className="topbar-title truncate">Websiteapp NPI</span>
      </div>
      <div className="topbar-right">
        <span className="hidden text-slate-400 sm:inline">{now.toLocaleString("id-ID")}</span>

        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
            {initials}
          </div>
          <div className="topbar-user">
            <span className="font-semibold text-slate-700">{user?.name}</span>
            <span className="access-badge">
              NIK {user?.nik} · {ACCESS_LABEL[user?.access ?? "INPUT"]}
            </span>
          </div>
        </div>

        <button className="btn btn-outline" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
