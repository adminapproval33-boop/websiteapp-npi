import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { put, del } from "@vercel/blob";
import { env } from "../../lib/env";

/** Restore & Hapus backup MENIMPA/MENGHILANGKAN data produksi secara permanen
 * -- dibatasi ke NIK ini saja (2026-09-08, instruksi eksplisit user), TIDAK
 * terkait level akses FULL_ACCESS biasa. Satu sumber kebenaran di sini (bukan
 * di backup.routes.ts lagi) supaya backupScheduler.ts juga bisa pakai daftar
 * yg sama saat mengirim email peringatan backup gagal (2026-10-04). */
export const ALLOWED_BACKUP_ADMIN_NIKS = ["000001", "019375", "001475", "012385", "019701"];

/** Folder permanen tempat file dump disimpan. Default: `<root-repo>/backups`
 * (1 folder di atas workspace "server", sama seperti backup manual yang sudah
 * ada sebelumnya) -- SELALU sebuah folder tetap di disk, TIDAK PERNAH
 * os.tmpdir(), supaya file dump tidak pernah "mampir" ke penyimpanan sementara. */
export function backupDir(): string {
  return env.backupDir || path.resolve(__dirname, "../../../../backups");
}

function ensureBackupDir(): string {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const FILENAME_RE = /^[A-Za-z0-9._-]+\.dump$/;

/** Cegah path traversal (mis. "../../../etc/passwd") lewat parameter filename dari client. */
export function assertSafeFilename(fileName: string): void {
  if (!FILENAME_RE.test(fileName)) {
    throw new Error("Nama file backup tidak valid.");
  }
}

function pgBinaryPath(binaryName: "pg_dump" | "pg_restore"): string {
  if (!env.pgBinDir) return binaryName;
  const exe = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
  return path.join(env.pgBinDir, exe);
}

/** DATABASE_URL Prisma pakai query param "schema" yang bukan keyword resmi
 * libpq (pg_dump/pg_restore bisa menolaknya sbg "invalid connection option") --
 * dibuang di sini sebelum dipakai sbg argumen `-d` ke pg_dump/pg_restore. */
function toPgCliConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

function runPgTool(binaryName: "pg_dump" | "pg_restore", args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pgBinaryPath(binaryName), args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `Gagal menjalankan ${binaryName} ("${err.message}"). Pastikan PostgreSQL client tools terpasang & PG_BIN_DIR di .env sudah benar kalau belum ada di PATH.`
        )
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${binaryName} keluar dengan kode ${code}.${stderr ? ` Detail: ${stderr.slice(-1500)}` : ""}`));
      }
    });
  });
}

export interface BackupFileInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export function listBackupFiles(): BackupFileInfo[] {
  const dir = ensureBackupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".dump"))
    .map((fileName) => {
      const stat = fs.statSync(path.join(dir, fileName));
      return { fileName, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Jalankan pg_dump (format custom `-Fc`, terkompresi & bisa direstore
 * selektif lewat pg_restore) -- `-f` membuat pg_dump menulis LANGSUNG ke file
 * tujuan final, tidak pernah lewat file sementara di tempat lain. */
export async function createBackup(labelPrefix: string): Promise<BackupFileInfo> {
  const dir = ensureBackupDir();
  const safeLabel = labelPrefix.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const fileName = `${safeLabel ? `${safeLabel}-` : ""}${timestampSlug()}.dump`;
  const destPath = path.join(dir, fileName);
  const connectionString = toPgCliConnectionString(env.databaseUrl);
  await runPgTool("pg_dump", ["-Fc", "-f", destPath, connectionString]);
  const stat = fs.statSync(destPath);
  return { fileName, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
}

/** Folder privat di Vercel Blob tempat salinan KEDUA tiap backup disimpan
 * (2026-10-04, instruksi eksplisit user: backup lokal SAJA satu titik
 * kegagalan tunggal krn ada di disk yg sama dgn database live -- lihat
 * createBackupWithOffsiteCopy di bawah). Nama file persis sama dgn file
 * lokalnya supaya gampang dipetakan utk dihapus lagi saat retensi jalan. */
const OFFSITE_BLOB_FOLDER = "db-backups";

/** Unggah 1 file dump yg SUDAH ADA di disk lokal sbg salinan kedua ke Vercel
 * Blob. Dipanggil terpisah dari createBackup() (lihat createBackupWithOffsiteCopy)
 * supaya kegagalan unggah ini TIDAK menggagalkan backup lokal yg sudah berhasil. */
export async function uploadBackupOffsiteCopy(fileName: string): Promise<string> {
  const filePath = backupFilePath(fileName);
  const buffer = await fs.promises.readFile(filePath);
  const pathname = `${OFFSITE_BLOB_FOLDER}/${fileName}`;
  await put(pathname, buffer, {
    access: "private",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
    token: env.blobReadWriteToken,
  });
  return pathname;
}

/** Best-effort -- dipanggil tiap kali backup lokal dihapus (manual/retensi)
 * supaya salinan cloud-nya ikut dibuang, tidak menumpuk selamanya. Boleh
 * gagal diam-diam (mis. salinan cloud memang belum pernah ada krn unggahan
 * awalnya gagal) -- itu bukan masalah, bukan kegagalan yg perlu dilaporkan. */
async function deleteBackupOffsiteCopy(fileName: string): Promise<void> {
  try {
    await del(`${OFFSITE_BLOB_FOLDER}/${fileName}`, { token: env.blobReadWriteToken });
  } catch {
    // Diamkan -- lihat komentar di atas.
  }
}

/** Buat backup lokal (wajib berhasil, sama spt createBackup() sebelumnya),
 * LALU coba unggah salinan keduanya ke Vercel Blob (boleh gagal -- backup
 * lokal tetap valid & terpakai walau salinan cloud gagal, lihat
 * blobPath: null di BackupEvent kalau itu terjadi). */
export async function createBackupWithOffsiteCopy(
  labelPrefix: string
): Promise<{ info: BackupFileInfo; blobPath: string | null }> {
  const info = await createBackup(labelPrefix);
  let blobPath: string | null = null;
  try {
    blobPath = await uploadBackupOffsiteCopy(info.fileName);
  } catch (err) {
    console.error("[backup] Gagal unggah salinan cloud (backup lokal tetap tersimpan):", err);
  }
  return { info, blobPath };
}

export async function deleteBackup(fileName: string): Promise<void> {
  assertSafeFilename(fileName);
  const filePath = path.join(backupDir(), fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error("File backup tidak ditemukan.");
  }
  fs.unlinkSync(filePath);
  await deleteBackupOffsiteCopy(fileName);
}

export function backupFilePath(fileName: string): string {
  assertSafeFilename(fileName);
  const filePath = path.join(backupDir(), fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error("File backup tidak ditemukan.");
  }
  return filePath;
}

/** Restore SELURUH database dari file dump `-Fc` -- `--clean --if-exists`
 * supaya objek lama (tabel/index/dsb) dibuang bersih dulu sebelum diisi ulang
 * dari dump, `--no-owner` supaya tidak gagal krn role owner beda antar mesin. */
export async function restoreBackup(fileName: string): Promise<void> {
  const filePath = backupFilePath(fileName);
  const connectionString = toPgCliConnectionString(env.databaseUrl);
  await runPgTool("pg_restore", ["--clean", "--if-exists", "--no-owner", "-d", connectionString, filePath]);
}

export interface DiskUsage {
  backupDirTotalBytes: number;
  backupFileCount: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export async function getDiskUsage(): Promise<DiskUsage> {
  const files = listBackupFiles();
  const backupDirTotalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  let diskFreeBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const stats = await fs.promises.statfs(ensureBackupDir());
    diskFreeBytes = stats.bavail * stats.bsize;
    diskTotalBytes = stats.blocks * stats.bsize;
  } catch {
    // fs.statfs bisa tidak didukung di sebagian lingkungan -- storage control
    // tetap tampil, cuma tanpa info kapasitas disk fisik.
  }

  return { backupDirTotalBytes, backupFileCount: files.length, diskFreeBytes, diskTotalBytes };
}

/** Terapkan retensi: hapus backup yang lebih tua dari `retentionDays` ATAU
 * kalau jumlah file melebihi `retentionMaxCount` (yang paling lama duluan).
 * Dipanggil otomatis setelah tiap backup baru (manual/otomatis) & lewat
 * tombol "Bersihkan Sekarang" -- return daftar nama file yang dihapus. */
export async function applyRetention(retentionDays: number, retentionMaxCount: number): Promise<string[]> {
  const files = listBackupFiles(); // sudah urut terbaru -> terlama
  const removed: string[] = [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const [idx, f] of files.entries()) {
    const isTooOld = retentionDays > 0 && new Date(f.createdAt).getTime() < cutoff;
    const isBeyondMaxCount = retentionMaxCount > 0 && idx >= retentionMaxCount;
    if (isTooOld || isBeyondMaxCount) {
      try {
        await deleteBackup(f.fileName);
        removed.push(f.fileName);
      } catch {
        // File mungkin sudah dihapus manual di antara listBackupFiles() & unlink -- abaikan.
      }
    }
  }

  return removed;
}
