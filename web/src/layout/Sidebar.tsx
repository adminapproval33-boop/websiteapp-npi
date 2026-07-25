import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { MenuNode, menuTree } from "./menu";

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
      <summary>{node.label}</summary>
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
  const visibleNodes = menuTree.filter((node) => !(node.type === "group" && node.fullAccessOnly) || user?.access === "FULL_ACCESS");

  return (
    <nav className={"sidebar" + (open ? " open" : "")}>
      <NavLink to="/" onClick={onNavigate} className={({ isActive }) => "sidebar-link !ml-2 font-bold" + (isActive ? " active" : "")}>
        🏠 Beranda
      </NavLink>
      {visibleNodes.map((node) => (
        <SidebarNode key={node.label} node={node} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}
