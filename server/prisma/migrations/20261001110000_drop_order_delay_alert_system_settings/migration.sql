-- Notifikasi Order Macet direvisi lagi (2026-10-01, instruksi eksplisit
-- user: "Pengaturan Sistem (Full Access) hilangkan saja, masukkan semuanya
-- ke menu Notifikasi, agar user bisa mandiri setting sendiri"). Tidak ada
-- lagi pengaturan sistem terpisah -- jam cek jadi konstanta tetap di kode
-- (orderDelayAlertScheduler.ts), saklar aktif/nonaktif juga tidak relevan
-- lagi krn scheduler otomatis jalan begitu ada user yg opt-in sendiri.
DROP TABLE "order_delay_alert_settings";
