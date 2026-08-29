import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Akhiri PAKSA semua sesi login yang sedang aktif (2026-08-29, instruksi
 * eksplisit user: setelah deploy redesign tampilan ke live, semua user yang
 * sedang login di-logout paksa supaya mereka "aware" dan langsung lihat
 * tampilan baru saat login ulang). Ditandai revoked (bukan hard delete)
 * lewat mekanisme yang sama dgn revokeSessionsForUser di lib/session.ts,
 * supaya frontend user yg kena tetap dapat pesan jelas ("Sesi Anda
 * diakhiri: ...") lewat validateSession(), bukan cuma error generik.
 */
async function main() {
  const reason =
    process.env.FORCE_LOGOUT_REASON ??
    "sistem diperbarui (tampilan baru) -- silakan login ulang untuk melihat perubahannya";

  const result = await prisma.session.updateMany({
    where: { expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date(), revokedReason: reason },
  });

  console.log(`Force-logout selesai: ${result.count} sesi aktif diakhiri paksa.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
