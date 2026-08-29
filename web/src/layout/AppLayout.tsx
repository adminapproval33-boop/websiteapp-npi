import { useEffect, useState } from "react";
import { useLocation, Outlet } from "react-router-dom";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import ChatWidget from "../components/ChatWidget";

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
          {/* `key={pathname}` sengaja dipasang di sini (bukan di <Outlet>
              langsung) supaya React remount div ini tiap pindah halaman --
              tanpa key, animasi CSS di bawah cuma jalan sekali pas app
              pertama load, karena elemen div-nya sendiri tidak pernah
              dibuat ulang walau isi <Outlet> berganti (2026-08-29, instruksi
              eksplisit user: transisi antar-menu terasa "patah"/instan). */}
          <div key={location.pathname} className="page-transition">
            <Outlet />
          </div>
        </main>
      </div>
      <footer className="statusbar">
        <span>Websiteapp-NPI Website Edition.&nbsp;&nbsp;&nbsp;Developed by teguh.agri@nipseapaint.com</span>
        <span>Status: Online</span>
      </footer>
      <ChatWidget />
    </div>
  );
}
