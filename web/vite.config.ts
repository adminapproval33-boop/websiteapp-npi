import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 8080 = port dev PRIBADI (bukan untuk rekan kerja). Port 5173 dipakai
    // oleh server "live" (production build, lihat websiteapp-npi-live) yang
    // memang alamat yang sudah dikenal rekan kerja -- sengaja dipertahankan
    // supaya mereka tidak perlu ganti bookmark (2026-08-25).
    port: 8080,
    host: true, // dengarkan di semua network interface (bukan cuma localhost) supaya bisa diakses dari HP di WiFi yang sama
    allowedHosts: true, // izinkan diakses lewat domain ngrok (host header selain localhost)
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
