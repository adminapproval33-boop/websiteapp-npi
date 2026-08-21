import { z } from "zod";

/**
 * Refine tambahan "tidak boleh tanggal yg belum terjadi" utk field Date
 * opsional/wajib tiap modul (2026-08-21, instruksi eksplisit user) -- root
 * cause: grafik Dashboard Produktivitas kecolongan titik data "di masa
 * depan" krn field `finish` production log diisi salah tanggal, TANPA
 * validasi apa pun di backend (cuma di frontend, yg bisa dilewati kalau API
 * dipanggil langsung). Dibandingkan ke AKHIR hari ini (23:59:59.999 waktu
 * lokal server) supaya jam berapa pun user input hari ini tetap lolos --
 * cuma tanggal SETELAH hari ini yg diblokir, sama persis logikanya dgn
 * `isFutureDate` di frontend (`web/src/lib/datetime.ts`).
 *
 * Generik atas `T extends ZodTypeAny` (bukan dibatasi ke `Date | null`
 * spesifik) krn pola `requiredDate`/`optionalDate` BEDA-BEDA tiap modul --
 * ada yg `z.coerce.date()` polos (output `Date`), ada yg union+transform
 * (output `Date | null`). Pengecekan runtime pakai `instanceof Date` supaya
 * aman dipakai ke pola mana pun tanpa peduli null-handling-nya.
 *
 * SENGAJA di-wrap per-FIELD (bukan ditempel ke `optionalDate`/`requiredDate`
 * dasar tiap modul), krn beberapa field lain yg SAH boleh tanggal masa depan
 * (mis. `scheduledDate` "Jadwal Pengerjaan" di Maintenance, `exp` "Expired"
 * hasil hitung di Production Label) juga kadang pakai schema dasar yg sama --
 * jangan sampai ikut kena blokir.
 */
export function notFutureDate<T extends z.ZodTypeAny>(schema: T, label: string): T {
  return schema.refine(
    (v: unknown) => {
      if (!(v instanceof Date)) return true;
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      return v.getTime() <= endOfToday.getTime();
    },
    { message: `${label} tidak boleh diisi tanggal yang belum terjadi (melebihi hari ini).` }
  ) as unknown as T;
}

/** Sama seperti `notFutureDate`, tapi utk field yg dikirim sbg STRING
 * "dd-mm-yyyy" (bukan Date hasil `z.coerce.date()`) -- kasus khusus "Lot No"
 * di Production Label/Label FG, yg di frontend sengaja diformat dulu jadi
 * string sebelum dikirim (lihat `formatDateDDMMYYYY` di web/src/lib/datetime.ts).
 * Format yg tidak dikenali (kosong/bukan dd-mm-yyyy) DILOLOSKAN -- bukan
 * tanggung jawab fungsi ini, biar aturan format lain yg menanganinya. */
export function notFutureDDMMYYYY<T extends z.ZodTypeAny>(schema: T, label: string): T {
  return schema.refine(
    (v: unknown) => {
      if (typeof v !== "string") return true;
      const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
      if (!m) return true;
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      return d.getTime() <= endOfToday.getTime();
    },
    { message: `${label} tidak boleh diisi tanggal yang belum terjadi (melebihi hari ini).` }
  ) as unknown as T;
}
