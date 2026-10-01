-- Notifikasi Order Macet direvisi lagi (2026-10-01, instruksi eksplisit
-- user): bukan lagi opt-in per-departemen, tapi opt-in PERSONAL PER TAHAP
-- proses + ambang hari personal. Pengaturan sistem (Developer
-- Tools/Settings > Pengaturan Sistem) jadi cuma jam cek & saklar aktif,
-- karena itu satu-satunya hal yg memang harus 1 nilai utk semua (scheduler
-- cuma jalan 1x sehari).

-- MasterEmployee: ganti saklar tunggal jadi 6 toggle per tahap + ambang personal.
ALTER TABLE "master_employees" DROP COLUMN "orderDelayNotifEnabled";
ALTER TABLE "master_employees" ADD COLUMN "notifyPremix" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_employees" ADD COLUMN "notifyMilling" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_employees" ADD COLUMN "notifyAftermix" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_employees" ADD COLUMN "notifyColourMatching" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_employees" ADD COLUMN "notifyQc" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_employees" ADD COLUMN "notifyApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "master_employees" ADD COLUMN "notifyThresholdDays" INTEGER NOT NULL DEFAULT 20;

-- OrderDelayAlertSetting: buang pemetaan departemen & ambang global -- sisa jam cek + saklar.
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "thresholdDays";
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "premixDept";
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "millingDept";
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "aftermixDept";
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "colourMatchingDept";
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "qcDept";
ALTER TABLE "order_delay_alert_settings" DROP COLUMN "approvalDept";

-- OrderDelayAlertEvent: "departemen" tidak relevan lagi, ganti jadi hitungan penerima.
ALTER TABLE "order_delay_alert_events" RENAME COLUMN "departmentsNotified" TO "recipientsNotified";
