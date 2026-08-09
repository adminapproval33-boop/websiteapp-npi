import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Avatar from "./Avatar";
import ChatWindow, { ChatContact } from "./ChatWindow";

/** Poll daftar online & unread count tiap 15 detik -- interval sama dgn poll
 * sesi login (lihat AuthContext.SESSION_POLL_MS), cukup responsif tanpa
 * membebani server. */
const POLL_MS = 15000;

/**
 * Panel "Kontak" mengambang di kanan-bawah layar (2026-08-09, instruksi
 * eksplisit user, gaya kolom Contacts Facebook) -- SELALU tampil di semua
 * halaman (dipasang di AppLayout, bukan di dalam Topbar), tidak perlu diklik
 * dulu utk lihat siapa yg online. Klik salah satu kontak -> buka jendela
 * chat mengambang di sebelah kirinya (gaya Messenger).
 */
export default function ChatWidget() {
  const { user } = useAuth();
  // Default CIUT (2026-08-09, instruksi eksplisit user) -- panel penuh
  // menutupi konten halaman kalau selalu terbuka (mis. Papan Info di
  // Beranda). Ciut = cuma bar judul "Kontak (N)" yg tetap kelihatan (jumlah
  // online tetap terjawab tanpa klik apa pun), daftar lengkap baru muncul
  // begitu user sengaja klik utk expand.
  const [collapsed, setCollapsed] = useState(true);
  const [openChats, setOpenChats] = useState<ChatContact[]>([]);

  const onlineQuery = useQuery({
    queryKey: ["chat-online"],
    queryFn: () => api.get<{ success: boolean; data: ChatContact[] }>("/chat/online").then((r) => r.data),
    refetchInterval: POLL_MS,
    enabled: !!user,
  });

  const unreadQuery = useQuery({
    queryKey: ["chat-unread-count"],
    queryFn: () => api.get<{ success: boolean; data: { count: number } }>("/chat/unread-count").then((r) => r.data.count),
    refetchInterval: POLL_MS,
    enabled: !!user,
  });

  const online = onlineQuery.data ?? [];
  const unreadCount = unreadQuery.data ?? 0;

  function openChat(contact: ChatContact) {
    setOpenChats((prev) => (prev.some((c) => c.nik === contact.nik) ? prev : [...prev, contact]));
  }

  function closeChat(nik: string) {
    setOpenChats((prev) => prev.filter((c) => c.nik !== nik));
  }

  if (!user) return null;

  return (
    <div style={{ position: "fixed", bottom: 0, right: 24, display: "flex", flexDirection: "row-reverse", alignItems: "flex-end", gap: 12, zIndex: 50 }}>
      <div className="panel" style={{ width: 260, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        <div
          className="panel-header"
          onClick={() => setCollapsed((v) => !v)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", position: "relative" }}
        >
          <span>
            Kontak {online.length > 0 && `(${online.length})`}
            {unreadCount > 0 && (
              <span style={{ display: "inline-block", marginLeft: 6, width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
            )}
          </span>
          <span style={{ color: "var(--muted)" }}>{collapsed ? "▲" : "▼"}</span>
        </div>

        {!collapsed && (
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
            {online.length === 0 && (
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "10px 0" }}>
                Tidak ada user lain yang online.
              </p>
            )}
            {online.map((c) => (
              <button
                key={c.nik}
                type="button"
                onClick={() => openChat(c)}
                className="chat-contact-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span style={{ position: "relative", flexShrink: 0 }}>
                  <Avatar name={c.name} avatarPath={c.avatarPath} size={32} />
                  <span
                    style={{
                      position: "absolute",
                      bottom: -1,
                      right: -1,
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "#22c55e",
                      border: "2px solid #fff",
                    }}
                  />
                </span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.department}</div>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {openChats.map((c) => (
        <ChatWindow key={c.nik} contact={c} onClose={() => closeChat(c.nik)} />
      ))}
    </div>
  );
}
