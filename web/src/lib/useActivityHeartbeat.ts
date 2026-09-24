import { useEffect, useRef } from "react";
import { api } from "../api/client";

const HEARTBEAT_THROTTLE_MS = 60_000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

/**
 * Kirim POST /chat/heartbeat begitu ada aktivitas nyata (mouse/keyboard/klik/
 * scroll/touch) DAN tab sedang terlihat, dibatasi max 1x per
 * HEARTBEAT_THROTTLE_MS -- sumber SATU-SATUNYA utk status "Online" (titik
 * hijau) & "Terakhir aktif" di panel Kontak (2026-09-23, instruksi eksplisit
 * user: sebelumnya status online ikut ke-refresh oleh polling background
 * Kontak/Chat sendiri, jadi tab yg dibuka tanpa disentuh tetap tampil hijau
 * terus-menerus). Dipasang SEKALI di ChatWidget (selalu ter-mount di semua
 * halaman lewat AppLayout) -- bukan di tiap halaman terpisah.
 */
export function useActivityHeartbeat(enabled: boolean) {
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function maybeSendHeartbeat() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastSentRef.current < HEARTBEAT_THROTTLE_MS) return;
      lastSentRef.current = now;
      api.post("/chat/heartbeat").catch(() => {
        /* diam-diam gagal (mis. sesi baru saja expired) -- tidak kritikal,
         * coba lagi di aktivitas berikutnya. */
      });
    }

    // Kirim sekali di awal (buka halaman/login itu sendiri sudah bukti
    // sedang ada orangnya), TIDAK perlu nunggu event aktivitas pertama.
    maybeSendHeartbeat();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, maybeSendHeartbeat, { passive: true });
    }
    document.addEventListener("visibilitychange", maybeSendHeartbeat);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, maybeSendHeartbeat);
      }
      document.removeEventListener("visibilitychange", maybeSendHeartbeat);
    };
  }, [enabled]);
}
