-- Fitur "Notifikasi HOD" diperluas jadi "Notifikasi Order Macet" (2026-10-01,
-- instruksi eksplisit user): penerima bukan lagi dibatasi ke karyawan yg
-- ditandai admin sbg HOD, tapi SIAPA SAJA di departemen tujuan yg sudah isi
-- email & opt-in sendiri lewat Settings > Notifikasi.

-- Flag "isHod" tidak lagi dipakai sama sekali -- dihapus total.
ALTER TABLE "master_employees" DROP COLUMN "isHod";

-- Preferensi pribadi opt-in notifikasi -- cuma ganti nama, datanya dipertahankan.
ALTER TABLE "master_employees" RENAME COLUMN "hodNotifEnabled" TO "orderDelayNotifEnabled";

-- Tabel pengaturan & log audit scheduler -- cuma ganti nama, datanya dipertahankan.
ALTER TABLE "hod_alert_settings" RENAME TO "order_delay_alert_settings";
ALTER TABLE "hod_alert_events" RENAME TO "order_delay_alert_events";
