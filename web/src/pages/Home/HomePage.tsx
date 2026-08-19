import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import PostsPage from "../Posts/PostsPage";

const WELCOME_SEEN_KEY_PREFIX = "npi_welcome_seen_";
/** Sama dgn POLL_MS di ChatWidget.tsx -- selagi user masih di Beranda,
 * tandai "sudah dilihat" berkala (bukan cuma sekali pas mount) supaya
 * notifikasi di Sidebar tidak muncul lagi utk post baru yg masuk SAAT user
 * masih membaca feed (lihat GET /posts/unread-count di posts.routes.ts). */
const MARK_SEEN_POLL_MS = 15000;

/**
 * Pesan sambutan (2026-08-09, instruksi eksplisit user) HANYA tampil sekali
 * per user (persist di localStorage per NIK) -- kunjungan Beranda berikutnya
 * langsung loncat ke feed Papan Info tanpa banner ini lagi.
 */
export default function HomePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (!user?.nik) return;
    const key = WELCOME_SEEN_KEY_PREFIX + user.nik;
    if (!localStorage.getItem(key)) {
      setShowWelcome(true);
      localStorage.setItem(key, "1");
    }
  }, [user?.nik]);

  const markSeenMutation = useMutation({
    mutationFn: () => api.post("/posts/mark-seen"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posts-unread-count"] }),
  });

  useEffect(() => {
    if (!user?.nik) return;
    markSeenMutation.mutate();
    const id = setInterval(() => markSeenMutation.mutate(), MARK_SEEN_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.nik]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 900, margin: "0 auto" }}>
      {showWelcome && (
        <div className="panel">
          <div className="panel-header">Welcome to Websiteapp NPI</div>
          <div className="panel-body">
            <p>
              Halo, <strong>{user?.name}</strong> ({user?.department}). Sistem ini adalah versi website mandiri dari
              Websiteapp NPI, menggantikan versi Google Apps Script agar input data dan pembacaan informasi berjalan
              jauh lebih cepat.
            </p>
            <p>Gunakan menu di sebelah kiri untuk mengakses modul yang tersedia.</p>
          </div>
        </div>
      )}
      <PostsPage />
    </div>
  );
}
