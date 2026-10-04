import path from "path";
import fs from "fs";
import { Router } from "express";
import { uploadsDir } from "../../lib/uploadStorage";
import { requireAuth } from "../../middleware/auth";

export const filesRouter = Router();

filesRouter.use(requireAuth);

/** Sajikan file lampiran dari disk lokal (2026-10-04, migrasi dari Vercel
 * Blob/Cloudflare R2 -- lihat uploadStorage.ts). Akses sudah dijaga requireAuth
 * di atas, jadi tidak perlu signed URL terpisah lagi seperti waktu masih di
 * cloud storage pihak ketiga. */
filesRouter.get("/*", (req, res) => {
  const pathname = (req.params as Record<string, string>)[0] ?? "";
  if (!pathname) {
    res.status(400).json({ success: false, message: "Path file tidak valid." });
    return;
  }

  const root = uploadsDir();
  const resolvedPath = path.resolve(root, pathname);
  // Cegah path traversal (mis. "../../.env") -- hasil resolve HARUS tetap di dalam root uploadsDir.
  if (resolvedPath !== root && !resolvedPath.startsWith(root + path.sep)) {
    res.status(400).json({ success: false, message: "Path file tidak valid." });
    return;
  }

  if (!fs.existsSync(resolvedPath)) {
    res.status(404).json({ success: false, message: "File tidak ditemukan." });
    return;
  }

  res.sendFile(resolvedPath, (err) => {
    if (err) {
      console.error("[files] Gagal mengirim file:", err instanceof Error ? err.message : err);
    }
  });
});
