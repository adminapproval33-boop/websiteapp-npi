import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { env } from "../../lib/env";

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

export function deleteBackup(fileName: string): void {
  assertSafeFilename(fileName);
  const filePath = path.join(backupDir(), fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error("File backup tidak ditemukan.");
  }
  fs.unlinkSync(filePath);
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
export function applyRetention(retentionDays: number, retentionMaxCount: number): string[] {
  const files = listBackupFiles(); // sudah urut terbaru -> terlama
  const removed: string[] = [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  files.forEach((f, idx) => {
    const isTooOld = retentionDays > 0 && new Date(f.createdAt).getTime() < cutoff;
    const isBeyondMaxCount = retentionMaxCount > 0 && idx >= retentionMaxCount;
    if (isTooOld || isBeyondMaxCount) {
      try {
        deleteBackup(f.fileName);
        removed.push(f.fileName);
      } catch {
        // File mungkin sudah dihapus manual di antara listBackupFiles() & unlink -- abaikan.
      }
    }
  });

  return removed;
}
