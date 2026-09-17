import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MenuNode, menuTree, filterHiddenMenus } from "./menu";

/** Sama dgn POLL_MS di ChatWidget.tsx -- notifikasi "ada postingan baru di
 * Beranda" (2026-08-19, instruksi eksplisit user), badge merah persis pola
 * badge unread chat, tapi utk Papan Info (lihat GET /posts/unread-count).
 * Query ditaruh di sini (bukan di HomePage) krn Sidebar selalu terpasang di
 * semua halaman (lihat AppLayout.tsx) -- badge harus tetap kelihatan walau
 * user lagi buka menu lain, bukan cuma pas di Beranda. */
const POSTS_POLL_MS = 15000;

/** Ikon per grup menu top-level (2026-08-29, senada mockup redesign sidebar
 * merah -- sebelumnya cuma "Beranda" yg py ikon 🏠, grup lain polos teks).
 * SEMUA node top-level di `menuTree` adalah group (lihat menu.tsx) jadi peta
 * ini otomatis mencakup semua ikon yg dibutuhkan mode "collapsed" di bawah
 * (2026-09-16, instruksi eksplisit user: sidebar bisa expand/collapse jadi
 * rail ikon saja). */
const GROUP_ICONS: Record<string, string> = {
  Dashboard: "📊",
  "Production & MRP Schedule": "🗓️",
  "Portal Quality Control": "✅",
  "Production Label": "🏷️",
  Maintenance: "🔧",
  "Purchase Requisition": "🛒",
  "Developer Tools": "💻",
};

const COLLAPSED_STORAGE_KEY = "npi_sidebar_collapsed";

function SidebarNode({ node, onNavigate }: { node: MenuNode; onNavigate: () => void }) {
  const { t } = useTranslation();
  if (node.type === "leaf") {
    return (
      <NavLink to={node.path} onClick={onNavigate} className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}>
        {t(node.label)}
      </NavLink>
    );
  }
  return (
    <details className="sidebar-group">
      <summary>
        {GROUP_ICONS[node.label] ? `${GROUP_ICONS[node.label]} ` : ""}
        {t(node.label)}
      </summary>
      {node.children.map((child) => (
        <SidebarNode key={child.label} node={child} onNavigate={onNavigate} />
      ))}
    </details>
  );
}

/** Satu ikon grup di mode "collapsed" (rail sempit) -- klik utk buka flyout
 * (panel melayang di sebelah kanan rail) berisi daftar menu anak grup ini,
 * sama isinya dgn `<details>` di mode expanded, cuma cara bukanya beda.
 * Ditutup lagi kalau: ikon yg sama diklik ulang, salah satu link di flyout
 * diklik (ikut `onNavigate`), user klik di luar area ini sama sekali
 * (listener `mousedown` di document), atau layar di-scroll/resize (posisi
 * yg dihitung jadi basi -- lihat effect di bawah).
 *
 * Dirender lewat React Portal ke `document.body` (2026-09-17, perbaikan bug
 * eksplisit user: flyout ketiban tombol "☰ Kolom" & isi tabel di baliknya).
 * Sebelumnya flyout ini `position: absolute` bersarang di dalam `.sidebar`,
 * dan z-index-nya (`.sidebar-flyout`, z-50) cuma berlaku DI DALAM stacking
 * context ancestor terdekat yg benar2 membentuk satu -- tapi `.sidebar`
 * sendiri di layar lg `position:relative` + `z-index:auto` (lihat komentar
 * `.sidebar` di app.css), jadi TIDAK membentuk stacking context sendiri;
 * akibatnya z-50 itu "bocor" ke context di luar sidebar dan kalah dibanding
 * elemen `position:relative` lain (mis. wrapper tombol Kolom di DataTable.tsx)
 * yg kebetulan tercat belakangan dlm urutan DOM. Portal ke `body` menghindari
 * masalah ini sepenuhnya: flyout jadi anak langsung `<body>`, dgn `position:
 * fixed` + koordinat dihitung dari `getBoundingClientRect()` tombolnya, jadi
 * selalu di lapisan paling atas apapun struktur DOM/CSS halaman yg lagi
 * dibuka. */
function CollapsedGroupIcon({ node, onNavigate }: { node: MenuNode; onNavigate: () => void }) {
  const { t } = useTranslation();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!flyoutOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      setFlyoutOpen(false);
    }
    function onWindowChange() {
      setFlyoutOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    // capture:true supaya tertangkap juga kalau yg di-scroll adalah
    // `.workspace` (bukan window itu sendiri) -- scroll di ancestor manapun
    // bikin posisi flyout yg sudah dihitung jadi basi.
    window.addEventListener("scroll", onWindowChange, true);
    window.addEventListener("resize", onWindowChange);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onWindowChange, true);
      window.removeEventListener("resize", onWindowChange);
    };
  }, [flyoutOpen]);

  if (node.type === "leaf") {
    return (
      <NavLink
        to={node.path}
        onClick={onNavigate}
        title={t(node.label)}
        className={({ isActive }) => "sidebar-collapsed-icon" + (isActive ? " active" : "")}
      >
        📄
      </NavLink>
    );
  }

  function toggleFlyout() {
    if (flyoutOpen) {
      setFlyoutOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setFlyoutPos({ top: rect.top, left: rect.right + 4 });
    setFlyoutOpen(true);
  }

  return (
    <div className="sidebar-collapsed-icon-wrapper">
      <button
        ref={buttonRef}
        type="button"
        className={"sidebar-collapsed-icon" + (flyoutOpen ? " active" : "")}
        title={t(node.label)}
        onClick={toggleFlyout}
      >
        {GROUP_ICONS[node.label] ?? "📁"}
      </button>
      {flyoutOpen &&
        flyoutPos &&
        createPortal(
          <div ref={flyoutRef} className="sidebar-flyout" style={{ position: "fixed", top: flyoutPos.top, left: flyoutPos.left }}>
            <div className="sidebar-flyout-title">{t(node.label)}</div>
            {node.children.map((child) => (
              <SidebarNode
                key={child.label}
                node={child}
                onNavigate={() => {
                  setFlyoutOpen(false);
                  onNavigate();
                }}
              />
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

/** `open` cuma berpengaruh di layar < lg (drawer overlay) -- di layar lg ke atas
 * sidebar selalu tampil sbg rail statis (lihat class `.sidebar` di app.css).
 * `collapsed` (2026-09-16, instruksi eksplisit user) -- beda konsep dari
 * `open`: ini nyempitin rail-nya sendiri jadi ikon saja (hemat ruang layar di
 * layar lg ke atas), tersimpan di localStorage spy tidak reset tiap pindah
 * halaman/refresh. Tidak berlaku ke drawer mobile (`open`) krn drawer mobile
 * sudah full-overlay, tidak ada ruang layar yg perlu dihemat di situ. */
export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* localStorage tidak tersedia -- state tetap jalan utk sesi ini saja */
      }
      return next;
    });
  }

  const visibleNodes = filterHiddenMenus(
    menuTree.filter((node) => !(node.type === "group" && node.fullAccessOnly) || user?.access === "FULL_ACCESS"),
    user
  );

  const postsUnreadQuery = useQuery({
    queryKey: ["posts-unread-count"],
    queryFn: () => api.get<{ success: boolean; data: { count: number } }>("/posts/unread-count").then((r) => r.data.count),
    refetchInterval: POSTS_POLL_MS,
    enabled: !!user,
  });
  const postsUnreadCount = postsUnreadQuery.data ?? 0;

  // Tab kecil menempel di TEPI KANAN sidebar, melayang di tengah tinggi
  // layar (2026-09-16, instruksi eksplisit user: gaya disamakan dgn tombol
  // collapse aplikasi trading saham yg dicontohkan -- bukan tombol bulat
  // terpisah di baris atas spt sebelumnya). Ditaruh sbg SIBLING dari
  // `.sidebar-scroll` (bukan child-nya) supaya tidak ikut ke-clip oleh
  // overflow-y-auto punya `.sidebar-scroll` walau separuh badannya nongol
  // keluar lebar sidebar -- lihat komentar `.sidebar`/`.sidebar-scroll` di
  // app.css utk kenapa `.sidebar` sendiri sekarang `overflow-visible` +
  // `lg:relative` (bukan `lg:static` lagi).
  const collapseTab = (
    <button
      type="button"
      className="sidebar-collapse-toggle"
      onClick={toggleCollapsed}
      title={t(collapsed ? "Perluas menu" : "Ciutkan menu")}
    >
      {collapsed ? "›" : "‹"}
    </button>
  );

  if (collapsed) {
    // SENGAJA TIDAK dibungkus `.sidebar-scroll` spt cabang expanded di bawah
    // -- rail collapsed cuma berisi ~9 ikon (selalu muat tanpa scroll), dan
    // yg lebih penting: flyout tiap ikon grup butuh keluar dari lebar rail
    // (64px) ke kanan, yg bakal ke-clip kalau ada ancestor `overflow-y-auto`
    // di antaranya (lihat komentar `.sidebar-scroll` di app.css).
    return (
      <nav className={"sidebar collapsed" + (open ? " open" : "")}>
        {collapseTab}
        <NavLink to="/" onClick={onNavigate} className={({ isActive }) => "sidebar-collapsed-icon" + (isActive ? " active" : "")} title={t("Beranda")}>
          🏠
          {postsUnreadCount > 0 && <span className="sidebar-collapsed-badge">{postsUnreadCount}</span>}
        </NavLink>
        {visibleNodes.map((node) => (
          <CollapsedGroupIcon key={node.label} node={node} onNavigate={onNavigate} />
        ))}
      </nav>
    );
  }

  return (
    <nav className={"sidebar" + (open ? " open" : "")}>
      {collapseTab}
      <div className="sidebar-scroll">
        <NavLink
          to="/"
          onClick={onNavigate}
          className={({ isActive }) => "sidebar-link !ml-2 font-bold" + (isActive ? " active" : "")}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          🏠 {t("Beranda")}
          {postsUnreadCount > 0 && (
            <span
              title={t("{{count}} postingan baru di Papan Info", { count: postsUnreadCount })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 9,
                background: "#ef4444",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {postsUnreadCount}
            </span>
          )}
        </NavLink>
        {visibleNodes.map((node) => (
          <SidebarNode key={node.label} node={node} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}
