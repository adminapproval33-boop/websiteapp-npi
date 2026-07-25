import { prisma } from "./prisma";
import { env } from "./env";

function expiryFromNow(): Date {
  return new Date(Date.now() + env.sessionTtlMinutes * 60 * 1000);
}

export async function createSession(nik: string): Promise<string> {
  const session = await prisma.session.create({
    data: { nik, expiresAt: expiryFromNow() },
  });
  return session.token;
}

/**
 * Validasi token dan kembalikan NIK pemiliknya. Setiap pemanggilan yang
 * valid memperpanjang masa berlaku sesi (sliding expiration), sama seperti
 * pola CacheService di versi Apps Script.
 */
export async function validateSession(token: string | undefined | null): Promise<string> {
  const cleanToken = String(token ?? "").trim();
  if (!cleanToken) {
    throw new SessionError("Sesi tidak valid. Silakan login ulang.");
  }

  const session = await prisma.session.findUnique({ where: { token: cleanToken } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { token: cleanToken } }).catch(() => {});
    throw new SessionError("Sesi telah berakhir. Silakan login ulang.");
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
