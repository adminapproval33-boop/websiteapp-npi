import { useEffect, useState } from "react";
import { useLocation, Outlet } from "react-router-dom";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Tutup drawer otomatis tiap kali pindah halaman -- supaya user di HP/Tablet
  // gak perlu tap tombol tutup manual sebelum bisa lihat konten halaman baru.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Topbar onMenuClick={() => setSidebarOpen((v) => !v)} />
      <div className="app-body">
        {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
        <main className="workspace">
          <Outlet />
        </main>
      </div>
      <footer className="statusbar">
        <span>Websiteapp NPI — Website Edition</span>
        <span>Status: Online</span>
      </footer>
    </div>
  );
}
