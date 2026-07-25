import { env } from "./env";

/**
 * Proteksi brute-force login, in-memory per proses server (setara
 * CacheService di versi Apps Script). Cukup untuk deployment 1 instance
 * (server pabrik / 1 VPS kecil). Kalau nanti di-scale ke banyak instance,
 * pindahkan ke tabel DB atau Redis.
 */
const attempts = new Map<string, { count: number; lockedUntil: number | null }>();

export function isLocked(nik: string): boolean {
  const entry = attempts.get(nik);
  if (!entry?.lockedUntil) return false;
  if (Date.now() > entry.lockedUntil) {
    attempts.delete(nik);
    return false;
  }
  return true;
}

export function registerFailure(nik: string): void {
  const entry = attempts.get(nik) ?? { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= env.loginMaxAttempts) {
    entry.lockedUntil = Date.now() + env.loginLockMinutes * 60 * 1000;
  }
  attempts.set(nik, entry);
}

export function clearFailures(nik: string): void {
  attempts.delete(nik);
}
