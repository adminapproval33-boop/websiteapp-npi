import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${name} wajib diisi (lihat .env.example).`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? 5),
  blobReadWriteToken: required("BLOB_READ_WRITE_TOKEN"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 20),
  // Batas terpisah & jauh lebih besar khusus utk import Master Data (Order/Tanki),
  // karena file referensi seperti export SAP-COOISPI bisa berisi jutaan baris --
  // beda kebutuhan dari batas lampiran dokumen biasa (MAX_UPLOAD_MB) yang sengaja
  // dijaga kecil.
  maxImportMb: Number(process.env.MAX_IMPORT_MB ?? 500),
  // Mode maintenance (2026-08-09, instruksi eksplisit user): kalau "true",
  // HANYA nik = maintenanceAllowedNik yang boleh login/pakai sesi -- semua
  // user lain langsung ditolak di /login DAN di-logout paksa lewat requireAuth
  // (lihat middleware/auth.ts) meskipun sesi mereka masih valid. Matikan lagi
  // dengan set MAINTENANCE_MODE=false lalu restart server.
  maintenanceMode: (process.env.MAINTENANCE_MODE ?? "false").toLowerCase() === "true",
  maintenanceAllowedNik: process.env.MAINTENANCE_ALLOWED_NIK ?? "",
};
