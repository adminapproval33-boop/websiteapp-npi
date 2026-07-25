import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
