import fs from "fs";
import path from "path";
import { uploadsDir } from "../../lib/uploadStorage";

export interface UploadsUsage {
  totalBytes: number;
  fileCount: number;
}

async function walk(dir: string): Promise<{ totalBytes: number; fileCount: number }> {
  let totalBytes = 0;
  let fileCount = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { totalBytes, fileCount }; // folder belum pernah dibuat (belum ada upload sama sekali) -- bukan error.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walk(full);
      totalBytes += sub.totalBytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      const stat = await fs.promises.stat(full);
      totalBytes += stat.size;
      fileCount += 1;
    }
  }
  return { totalBytes, fileCount };
}

/** Total pemakaian disk folder lampiran upload (2026-10-04, migrasi dari
 * Vercel Blob/Cloudflare R2 ke disk lokal -- lihat uploadStorage.ts) --
 * bagian dari fitur kontrol storage supaya admin bisa lihat SEMUA tempat
 * data tersimpan, bukan cuma folder backup database. */
export async function getUploadsUsage(): Promise<UploadsUsage> {
  return walk(uploadsDir());
}
