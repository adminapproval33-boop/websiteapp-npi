/**
 * Kunci zona waktu proses Node ke WIB (Asia/Jakarta), TERLEPAS dari
 * konfigurasi OS/container server yg menjalankannya (2026-09-23, instruksi
 * eksplisit user). Root cause laporan nyata: History Milling & Check
 * Results py Start/Finish/Form Received yg "maju" ke hari berikutnya --
 * ternyata bukan validasi tanggal-masa-depan yg bolong, tapi field
 * `<input type="datetime-local">` di frontend (mis. toDateTimeLocalValue di
 * web/src/lib/datetime.ts) mengirim teks POLOS TANPA info zona waktu (mis.
 * "2026-09-22T18:59"), lalu `new Date(...)`/`z.coerce.date()` di server
 * MENAFSIRKANNYA sbg waktu lokal MESIN SERVER ITU SENDIRI -- kalau server
 * live jalan di zona UTC (umum utk server cloud/Linux, beda 7 jam dari
 * WIB), jam yg diketik admin sbg WIB otomatis "maju" 7 jam saat disimpan,
 * dan kalau pergeserannya kebetulan lewat tengah malam, tanggalnya ikut
 * maju ke hari berikutnya. Dev machine (Windows, kebetulan sudah ter-set
 * Asia/Bangkok = UTC+7, SAMA persis dgn WIB) tidak pernah kena krn
 * kebetulan zona waktunya cocok -- baru kelihatan di server live yg
 * (kemungkinan besar) zona waktunya beda.
 *
 * HARUS jadi import PERTAMA di src/index.ts (sebelum import lain manapun)
 * supaya `process.env.TZ` sudah ter-set SEBELUM modul apa pun sempat
 * menyentuh Date/Intl -- v8/Node meng-cache info zona waktu begitu
 * dipakai pertama kali, jadi mengubah `process.env.TZ` belakangan (setelah
 * modul lain jalan) tidak dijamin efektif.
 */
process.env.TZ = "Asia/Jakarta";
export {};
