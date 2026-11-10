import { prisma } from "./prisma";

/** "Booking tanki" (2026-09-20, instruksi eksplisit user) -- tombol Booking di
 * pop-up Info Proses (Premix/Aftermix) menyimpan baris TankManualInput dgn
 * remark diawali "Booking Premix"/"Booking Aftermix". Tidak ada kolom khusus
 * di DB (spy tidak perlu migrasi baru), jadi penanda booking = awalan remark
 * ini -- HANYA lewat helper ini spy cek-nya konsisten di semua tempat. */
export type BookingSection = "PREMIX" | "AFTERMIX";

export function bookingRemark(section: BookingSection, note?: string | null): string {
  const label = section === "PREMIX" ? "Premix" : "Aftermix";
  const trimmed = (note ?? "").trim();
  return trimmed ? `Booking ${label} - ${trimmed}` : `Booking ${label}`;
}

/** null = remark ini BUKAN booking (entri Input Manual biasa). */
export function parseBookingSection(remark: string | null | undefined): BookingSection | null {
  const m = /^Booking (Premix|Aftermix)\b/.exec(remark ?? "");
  if (!m) return null;
  return m[1] === "Premix" ? "PREMIX" : "AFTERMIX";
}

/** Awalan remark literal ("Booking Premix"/"Booking Aftermix") tanpa catatan
 * -- dipakai filter `remark: { startsWith: ... }` di query Prisma, supaya
 * tidak ada string literal "Booking Premix"/"Booking Aftermix" tersebar
 * berulang di banyak file (sumber bug kalau suatu saat formatnya diubah di
 * `bookingRemark` tapi lupa disamakan di semua query). */
export function bookingRemarkPrefix(section: BookingSection): string {
  return bookingRemark(section);
}

/** Syarat booking dianggap GUGUR (released) -- SAMA PERSIS dgn
 * `isBookingReleased` di dashboard.routes.ts (buildTankStatusMap), JANGAN
 * diubah salah satu tanpa yang lain: (a) Order booking itu sendiri SUDAH py
 * input asli di section yg sama (Premix/Aftermix), ATAU (b) tanki ini sudah
 * dipakai Order LAIN (bukan Order booking ini) SESUDAH booking ini dibuat,
 * lewat Premix/Aftermix/Milling/Colour Matching manapun. Versi INI query
 * per-baris ke DB (bukan dari array yg sudah di-load bulk spt di dashboard)
 * krn dipakai di luar konteks dashboard load -- oleh `findActiveBookingConflict`
 * (cek saat booking BARU dibuat) & `bookingCleanupScheduler` (job berkala
 * hapus booking yg sudah gugur), 2026-11-10 instruksi eksplisit user: root
 * cause laporan "tanki jumping" krn booking gugur tidak pernah dihapus,
 * cuma diabaikan saat dihitung Tank Monitoring. */
async function isBookingRowReleased(booking: { id: string; order: string; codeTanki: string; remark: string | null; timestamp: Date }): Promise<boolean> {
  const section = parseBookingSection(booking.remark);
  if (!section) return false;
  const hasRealInput = await prisma.premixAftermixLog.findFirst({ where: { order: booking.order, section } });
  if (hasRealInput) return true;
  const [reusedByPremixAftermix, reusedByMilling, reusedByColourMatching] = await Promise.all([
    prisma.premixAftermixLog.findFirst({
      where: { codeTanki: booking.codeTanki, order: { not: booking.order }, timestamp: { gt: booking.timestamp } },
    }),
    prisma.millingLog.findFirst({
      where: {
        OR: [{ codeTanki1: booking.codeTanki }, { codeTanki2: booking.codeTanki }],
        order: { not: booking.order },
        timestamp: { gt: booking.timestamp },
      },
    }),
    prisma.colourMatchingLog.findFirst({
      where: { codeTanki: booking.codeTanki, order: { not: booking.order }, timestamp: { gt: booking.timestamp } },
    }),
  ]);
  return Boolean(reusedByPremixAftermix || reusedByMilling || reusedByColourMatching);
}

export interface BookingConflict {
  order: string;
  plannedStart: Date | null;
  timestamp: Date;
  inputBy: string;
}

/** Cek apakah `codeTanki` sedang dibooking AKTIF (belum gugur) oleh Order
 * LAIN selain `excludeOrder` -- dipakai `POST /booking` (tankManualInput.routes.ts)
 * utk memperingatkan SEBELUM membuat booking baru yg numpuk di tanki yg sama
 * (2026-11-10, instruksi eksplisit user -- laporan nyata tanki 128/IU1 py 4
 * booking aktif numpuk dari Order berbeda, bikin status "jumping" tiap kali
 * ada booking baru dibuat/gugur). null = tidak ada konflik, aman dibooking. */
export async function findActiveBookingConflict(codeTanki: string, excludeOrder: string): Promise<BookingConflict | null> {
  const bookings = await prisma.tankManualInput.findMany({
    where: {
      codeTanki,
      order: { not: excludeOrder },
      OR: [{ remark: { startsWith: "Booking Premix" } }, { remark: { startsWith: "Booking Aftermix" } }],
    },
    orderBy: { timestamp: "desc" },
  });
  for (const b of bookings) {
    if (await isBookingRowReleased(b)) continue;
    return { order: b.order, plannedStart: b.plannedStart, timestamp: b.timestamp, inputBy: b.inputBy };
  }
  return null;
}

/** Hapus permanen baris Booking Tanki yg sudah gugur, lintas SEMUA tanki
 * (2026-11-10, instruksi eksplisit user) -- dipanggil berkala oleh
 * `bookingCleanupScheduler`. Idempoten & aman dipanggil berulang kali, cuma
 * menghapus yg memang sudah gugur. Mengembalikan jumlah baris yg dihapus. */
export async function cleanupReleasedBookings(): Promise<number> {
  const bookings = await prisma.tankManualInput.findMany({
    where: { OR: [{ remark: { startsWith: "Booking Premix" } }, { remark: { startsWith: "Booking Aftermix" } }] },
  });
  const toDelete: string[] = [];
  for (const b of bookings) {
    if (await isBookingRowReleased(b)) toDelete.push(b.id);
  }
  if (toDelete.length === 0) return 0;
  await prisma.tankManualInput.deleteMany({ where: { id: { in: toDelete } } });
  return toDelete.length;
}
