import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
 * merah -- sebelumnya cuma "Beranda" yg py ikon 🏠, grup lain polos teks). */
const GROUP_ICONS: Record<string, string> = {
  Dashboard: "📊",
  "Production & MRP Schedule": "🗓️",
  "Portal Quality Control": "✅",
  "Production Label": "🏷️",
  Maintenance: "🔧",
  "Purchase Requisition": "🛒",
  "Developer Tools": "💻",
};

function SidebarNode({ node, onNavigate }: { node: MenuNode; onNavigate: () => void }) {
  if (node.type === "leaf") {
    return (
      <NavLink to={node.path} onClick={onNavigate} className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}>
        {node.label}
      </NavLink>
    );
  }
  return (
    <details className="sidebar-group">
      <summary>
        {GROUP_ICONS[node.label] ? `${GROUP_ICONS[node.label]} ` : ""}
        {node.label}
      </summary>
      {node.children.map((child) => (
        <SidebarNode key={child.label} node={child} onNavigate={onNavigate} />
      ))}
    </details>
  );
}

/** `open` cuma berpengaruh di layar < lg (drawer overlay) -- di layar lg ke atas
 * sidebar selalu tampil sbg rail statis (lihat class `.sidebar` di app.css). */
export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user } = useAuth();
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

  return (
    <nav className={"sidebar" + (open ? " open" : "")}>
      <NavLink
        to="/"
        onClick={onNavigate}
        className={({ isActive }) => "sidebar-link !ml-2 font-bold" + (isActive ? " active" : "")}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        🏠 Beranda
        {postsUnreadCount > 0 && (
          <span
            title={`${postsUnreadCount} postingan baru di Papan Info`}
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
    </nav>
  );
}
