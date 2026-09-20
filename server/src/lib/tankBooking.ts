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
