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
  const [search, setSearch] = useState("");

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

  /** Rincian per-pengirim (2026-08-11, instruksi eksplisit user: badge total
   * di header "Kontak (14)" tidak menjawab pesan itu dari siapa) -- dipakai
   * utk kasih badge merah + jumlah di baris kontak yg kirim pesan belum
   * dibaca, TERMASUK kontak yg sedang OFFLINE (tidak nongol di daftar
   * online) supaya tetap ketahuan siapa yg chat. */
  const unreadBySenderQuery = useQuery({
    queryKey: ["chat-unread-by-sender"],
    queryFn: () =>
      api
        .get<{ success: boolean; data: (ChatContact & { count: number; lastMessageAt: string })[] }>("/chat/unread-by-sender")
        .then((r) => r.data),
    refetchInterval: POLL_MS,
    enabled: !!user,
  });

  /** Cari kontak by nama (2026-08-11, instruksi eksplisit user) -- daftar
   * biasa cuma online+unread, jadi user offline yg belum pernah chat tidak
   * ketemu sama sekali kalau tidak ada pencarian ini. Query cuma jalan kalau
   * ada teks dicari (hemat request); dipisah dari poll interval krn ini
   * "on demand", bukan polling berkala. */
  const searchQuery = useQuery({
    queryKey: ["chat-search", search.trim()],
    queryFn: () =>
      api
        .get<{ success: boolean; data: (ChatContact & { isOnline: boolean })[] }>(`/chat/search?q=${encodeURIComponent(search.trim())}`)
        .then((r) => r.data),
    enabled: !!user && search.trim().length > 0,
  });

  const online = onlineQuery.data ?? [];
  const unreadCount = unreadQuery.data ?? 0;
  const unreadBySender = unreadBySenderQuery.data ?? [];
  const unreadCountByNik = new Map(unreadBySender.map((u) => [u.nik, u.count]));
  const onlineNiks = new Set(online.map((c) => c.nik));
  const offlineWithUnread = unreadBySender.filter((u) => !onlineNiks.has(u.nik));
  const isSearching = search.trim().length > 0;
  // Urutan tampil (mode biasa, TIDAK sedang cari): kontak (online/offline) yg
  // py pesan belum dibaca duluan -- offline dulu (paling gampang kelewat krn
  // ga ada titik hijau), baru online yg unread, baru sisanya online tanpa
  // unread apa adanya. Mode CARI: langsung pakai hasil /chat/search apa
  // adanya (server yg tentukan online/offline & urutan by nama).
  const displayContacts: (ChatContact & { isOnline: boolean })[] = isSearching
    ? searchQuery.data ?? []
    : [
        ...offlineWithUnread.map((c) => ({ ...c, isOnline: false })),
        ...online.filter((c) => unreadCountByNik.has(c.nik)).map((c) => ({ ...c, isOnline: true })),
        ...online.filter((c) => !unreadCountByNik.has(c.nik)).map((c) => ({ ...c, isOnline: true })),
      ];

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
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: 6,
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                  borderRadius: 8,
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  verticalAlign: "middle",
                }}
              >
                {unreadCount}
              </span>
            )}
          </span>
          <span style={{ color: "var(--muted)" }}>{collapsed ? "▲" : "▼"}</span>
        </div>

        {!collapsed && (
          <div style={{ padding: "6px 6px 0" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Cari nama kontak..."
              style={{ width: "100%", fontSize: 12, padding: "5px 8px" }}
            />
          </div>
        )}

        {!collapsed && (
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
            {isSearching && searchQuery.isFetching && displayContacts.length === 0 && (
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "10px 0" }}>Mencari...</p>
            )}
            {isSearching && !searchQuery.isFetching && displayContacts.length === 0 && (
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "10px 0" }}>
                Tidak ada kontak dengan nama "{search.trim()}".
              </p>
            )}
            {!isSearching && displayContacts.length === 0 && (
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "10px 0" }}>
                Tidak ada user lain yang online.
              </p>
            )}
            {displayContacts.map((c) => {
              const unread = unreadCountByNik.get(c.nik) ?? 0;
              return (
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
                    background: unread > 0 ? "rgba(239, 68, 68, 0.08)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{ position: "relative", flexShrink: 0 }}>
                    <Avatar name={c.name} avatarPath={c.avatarPath} size={32} />
                    {/* Titik online/offline (2026-08-11: offline digelapkan,
                        BUKAN dihilangkan -- kontak yg kirim pesan lalu logout
                        harus tetap kelihatan beda dari yg online). */}
                    <span
                      style={{
                        position: "absolute",
                        bottom: -1,
                        right: -1,
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: c.isOnline ? "#22c55e" : "#94a3b8",
                        border: "2px solid #fff",
                      }}
                    />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: unread > 0 ? 700 : 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {c.department}
                      {!c.isOnline && " · Offline"}
                    </div>
                  </span>
                  {unread > 0 && (
                    <span
                      title={`${unread} pesan belum dibaca dari ${c.name}`}
                      style={{
                        flexShrink: 0,
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
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {openChats.map((c) => (
        <ChatWindow key={c.nik} contact={c} onClose={() => closeChat(c.nik)} />
      ))}
    </div>
  );
}
