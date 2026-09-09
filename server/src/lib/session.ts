import { prisma } from "./prisma";
import { env } from "./env";

function expiryFromNow(): Date {
  return new Date(Date.now() + env.sessionTtlMinutes * 60 * 1000);
}

export async function createSession(nik: string, ip?: string | null, userAgent?: string | null): Promise<string> {
  const session = await prisma.session.create({
    data: { nik, expiresAt: expiryFromNow(), ip: ip ?? null, userAgent: userAgent ?? null },
  });
  return session.token;
}

/** True kalau NIK ini punya sesi lain yg masih berlaku -- dipakai gerbang
 * "1 NIK cuma boleh 1 sesi aktif" (2026-08-08, instruksi eksplisit user,
 * spt SAP) di POST /auth/login sebelum sesi baru dibuat. */
export async function hasActiveSession(nik: string): Promise<boolean> {
  const count = await prisma.session.count({ where: { nik, expiresAt: { gt: new Date() } } });
  return count > 0;
}

/** Akhiri PAKSA semua sesi NIK ini (dipanggil saat login baru dgn `force`
 * dikonfirmasi user) -- SENGAJA cuma menandai expired+alasan (bukan hard
 * delete) supaya `validateSession` masih bisa kasih pesan spesifik ("diakhiri
 * krn login di perangkat lain") ke sesi lama itu saat dipakai lagi, baru
 * dibuang beneran lewat jalur lazy-delete yg sudah ada. */
export async function revokeSessionsForUser(nik: string, reason: string): Promise<void> {
  await prisma.session.updateMany({ where: { nik }, data: { expiresAt: new Date(), revokedReason: reason } });
}

/**
 * Validasi token dan kembalikan NIK pemiliknya. Setiap pemanggilan yang
 * valid memperpanjang masa berlaku sesi (sliding expiration), sama seperti
 * pola CacheService di versi Apps Script.
 *
 * Kalau `ip`/`userAgent` diisi, DIBANDINGKAN dgn yg tercatat saat sesi ini
 * dibuat (lihat createSession) -- request yg tidak cocok DITOLAK (401) tapi
 * sesi-nya SENGAJA tidak dihapus/expire, supaya perangkat yg sah (yg terus
 * request dgn IP+UA yg cocok) tidak ikut ke-logout gara-gara ada perangkat
 * lain yg pakai token hasil salinan manual (2026-09-09).
 */
export async function validateSession(
  token: string | undefined | null,
  ip?: string | null,
  userAgent?: string | null
): Promise<string> {
  const cleanToken = String(token ?? "").trim();
  if (!cleanToken) {
    throw new SessionError("Sesi tidak valid. Silakan login ulang.");
  }

  const session = await prisma.session.findUnique({ where: { token: cleanToken } });
  if (!session || session.expiresAt < new Date()) {
    const revokedReason = session?.revokedReason ?? null;
    if (session) await prisma.session.delete({ where: { token: cleanToken } }).catch(() => {});
    throw new SessionError(
      revokedReason ? `Sesi Anda diakhiri: ${revokedReason}. Silakan login ulang.` : "Sesi telah berakhir. Silakan login ulang."
    );
  }

  if (session.ip && ip && session.ip !== ip) {
    throw new SessionError("Sesi ini terdaftar dari perangkat/IP lain. Silakan login ulang dari perangkat ini.");
  }
  if (session.userAgent && userAgent && session.userAgent !== userAgent) {
    throw new SessionError("Sesi ini terdaftar dari perangkat/browser lain. Silakan login ulang dari perangkat ini.");
  }

  await prisma.session.update({
    where: { token: cleanToken },
    data: { expiresAt: expiryFromNow() },
  });

  return session.nik;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { token } }).catch(() => {});
}

export class SessionError extends Error {}
