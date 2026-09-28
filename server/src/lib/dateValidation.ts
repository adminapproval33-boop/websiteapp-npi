import { z } from "zod";

/**
 * Rentang tanggal "wajar" -- batas ATAS = AKHIR hari ini (23:59:59.999 waktu
 * lokal server, spt semula -- jam berapa pun user input HARI INI tetap
 * lolos), batas BAWAH = persis 1 tahun ke belakang dari sekarang (bukan
 * tahun kalender tetap) (2026-09-28, instruksi eksplisit user -- sempat
 * dicoba diperketat ke "persis detik ini" tapi dibalik lagi krn kebanyakan
 * blokir input jam wajar yg masih di hari yg sama). Root cause 3 laporan
 * terpisah yg mendorong batas BAWAH ini: Order 1040008541 py Packing Finish
 * "0006-09-25" -- tahun ketiban jadi "0006" alih-alih "2026", kemungkinan
 * besar krn native date-picker browser meloloskan tahun yg belum lengkap
 * diketik; Order 1020055068 py Colour Matching Finish "1970-01-01" -- pola
 * khas `new Date(null)`/`new Date(undefined)` yg diam-diam dianggap "detik
 * ke-nol" alih-alih ditolak; Order 1010165713 py Approval Finish App
 * "0001-01-01". Ketiganya LOLOS begitu saja sebelum ini krn versi lama
 * `notFutureDate` cuma mengecek "tidak boleh di masa depan" -- tanggal yg
 * jauh ke BELAKANG, sekonyol apa pun, tetap dianggap sah. Dihitung ULANG
 * tiap kali fungsi dipanggil (bukan konstanta modul-level) supaya "hari
 * ini" & "1 tahun lalu" selalu akurat relatif thd waktu request, bukan
 * waktu server pertama kali start. */
function getSensibleRange(): { min: Date; max: Date } {
  const max = new Date();
  max.setHours(23, 59, 59, 999);
  const min = new Date();
  min.setFullYear(min.getFullYear() - 1);
  return { min, max };
}

/**
 * Refine tambahan "tidak boleh tanggal yg belum terjadi, & tidak boleh
 * tanggal yg konyol jauh ke belakang" utk field Date opsional/wajib tiap
 * modul (2026-08-21, instruksi eksplisit user, DIPERKETAT 2026-09-28 --
 * lihat `getSensibleRange` di atas). Root cause awal (Agustus): grafik
 * Dashboard Produktivitas kecolongan titik data "di masa depan" krn field
 * `finish` production log diisi salah tanggal, TANPA validasi apa pun di
 * backend (cuma di frontend, yg bisa dilewati kalau API dipanggil langsung).
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
      const { min, max } = getSensibleRange();
      return v.getTime() >= min.getTime() && v.getTime() <= max.getTime();
    },
    { message: `${label} tidak valid -- tidak boleh di masa depan atau lebih dari 1 tahun yang lalu.` }
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
      const { min, max } = getSensibleRange();
      return d.getTime() >= min.getTime() && d.getTime() <= max.getTime();
    },
    { message: `${label} tidak valid -- tidak boleh di masa depan atau lebih dari 1 tahun yang lalu.` }
  ) as unknown as T;
}
