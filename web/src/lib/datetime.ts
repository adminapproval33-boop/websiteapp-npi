/** Format Date/ISO string ke value yang dipahami <input type="datetime-local">. */
export function toDateTimeLocalValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Tanggal HARI INI (YYYY-MM-DD, waktu lokal browser) -- dipakai sbg atribut
 * `max` di <input type="date"> DAN sbg acuan `isFutureDate` di bawah. */
export function todayDateValue(): string {
  return toDateTimeLocalValue(new Date()).slice(0, 10);
}

/** True kalau TANGGAL (bagian "YYYY-MM-DD" -- jam diabaikan) dari `value`
 * lebih besar dari tanggal HARI INI (2026-08-21, instruksi eksplisit user:
 * field spt Start/Finish/Form Received menandakan proses yg SUDAH terjadi,
 * jadi tidak boleh diisi tanggal yg belum terjadi -- ditemukan lewat grafik
 * Dashboard Produktivitas yg kecolongan titik data "di masa depan" krn field
 * `finish` production log diisi salah tanggal). Dipakai utk kedua tipe input
 * (<input type="date"> MAUPUN type="datetime-local">) krn keduanya sama-sama
 * berawalan "YYYY-MM-DD". String kosong bukan tanggung jawab fungsi ini
 * (required/optional diatur terpisah di pemanggil). */
export function isFutureDate(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.slice(0, 10) > todayDateValue();
}

/** Pesan error siap pakai kalau `value` melebihi hari ini, else `null` --
 * `label` = nama field utk pesan (mis. "Finish", "QC Entry Date"), dipanggil
 * dari validasi submit tiap modul (lihat pemanggil utk daftar field). */
export function validateNotFutureDate(value: string | null | undefined, label: string): string | null {
  return isFutureDate(value)
    ? `${label} tidak boleh diisi tanggal yang belum terjadi (melebihi hari ini). Periksa kembali tanggalnya.`
    : null;
}

/** Format Date/ISO string untuk ditampilkan di tabel history. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** Format Date/ISO string (tanpa jam) ke dd-mm-yyyy -- dipakai Lot No & Exp
 * di Production Label (2026-08-04, instruksi eksplisit user: keduanya
 * harus seragam formatnya, pakai strip bukan garis miring). */
export function formatDateDDMMYYYY(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * Format tanggal "mentah" (YYYY-MM-DD HH:mm:ss) KHUSUS untuk export CSV --
 * bukan `formatDateTime` yang sudah diformat jadi teks lokal ("17 Jul 2026,
 * 15.10"). Format ISO-like ini otomatis dikenali Excel sebagai tanggal asli
 * saat file CSV dibuka, sehingga bisa diubah bebas lewat Format Cells >
 * Date (mis. jadi dd/mmm/yy) -- kalau yang diekspor teks sudah-diformat,
 * Excel menganggapnya teks biasa dan opsi format tanggal tidak berlaku.
 */
export function toExcelDateTimeString(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}`;
}
