import { cleanupReleasedBookings } from "../../lib/tankBooking";
import { cleanupCompletedSchedules } from "../premixAftermix/premixAftermix.routes";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // sama granularitas dgn backupScheduler.ts -- cukup utk kebutuhan ini.

/** Hapus permanen baris Booking Tanki yg sudah gugur, DAN baris PwoSchedule
 * (kartu Kalender PWO Schedule & Queue) yg Order-nya sudah diproses beneran,
 * berkala (2026-11-10, instruksi eksplisit user -- root cause laporan nyata
 * "tanki jumping": baris yg sudah gugur/selesai SEBELUMNYA cuma diabaikan
 * saat dihitung, tidak pernah dihapus dari database, jadi terus menumpuk --
 * lihat cleanupReleasedBookings di lib/tankBooking.ts & cleanupCompletedSchedules
 * di premixAftermix.routes.ts utk syarat masing-masing, HARUS tetap sama
 * persis dgn isBookingReleased/getOrdersWithRealInput). Kedua kartu/baris ini
 * SUDAH disembunyikan scr live di endpoint GET-nya masing-masing (tank-status
 * & pwo-schedule) -- scheduler ini cuma housekeeping fisik database, TIDAK
 * ada user-facing delay yg bergantung ke jadwal 15 menit ini. Pola setInterval
 * sama dgn backupScheduler.ts, tanpa dependency cron eksternal. */
export function startBookingCleanupScheduler() {
  const run = () => {
    cleanupReleasedBookings()
      .then((count) => {
        if (count > 0) console.log(`[booking-cleanup] Hapus ${count} booking tanki yg sudah gugur.`);
      })
      .catch((err) => console.error("[booking-cleanup] Pengecekan booking gagal:", err));
    cleanupCompletedSchedules()
      .then((count) => {
        if (count > 0) console.log(`[booking-cleanup] Hapus ${count} kartu PWO Schedule yg Order-nya sudah diproses.`);
      })
      .catch((err) => console.error("[booking-cleanup] Pengecekan PWO Schedule gagal:", err));
  };
  run();
  setInterval(run, CHECK_INTERVAL_MS);
}
