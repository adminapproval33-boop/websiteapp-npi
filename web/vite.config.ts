import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 8080 = port dev PRIBADI (bukan untuk rekan kerja). Rekan kerja akses
    // http://mes.nipseapaint.com:8090/login (dikelola tim IT, di-update lewat
    // email setelah kode di-push ke GitHub) -- bukan port lokal ini.
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
