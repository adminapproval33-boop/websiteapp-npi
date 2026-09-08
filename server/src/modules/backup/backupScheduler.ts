import { prisma } from "../../lib/prisma";
import { applyRetention, createBackup } from "./backupService";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cek tiap 15 menit -- cukup granular utk jadwal per-jam tanpa perlu dependency cron.

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, waktu server
}

/** Backup otomatis harian, tanpa dependency cron eksternal -- cukup polling
 * ringan tiap 15 menit (2026-09-08, instruksi eksplisit user: "sistem backup
 * manajemen"). Jalan cuma SEKALI per hari per jam yang dikonfigurasi,
 * dicek lewat ada/tidaknya BackupEvent AUTO_CREATE hari ini supaya aman
 * walau server di-restart berkali-kali dalam 1 hari yang sama. */
async function runAutoBackupCheck() {
  const setting = await prisma.backupSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  if (!setting.autoBackupEnabled) return;

  const now = new Date();
  if (now.getHours() !== setting.autoBackupHour) return;

  const alreadyRanToday = await prisma.backupEvent.findFirst({
    where: {
      action: "AUTO_CREATE",
      createdAt: { gte: new Date(`${todayKey()}T00:00:00`) },
    },
  });
  if (alreadyRanToday) return;

  try {
    const info = await createBackup("auto");
    await prisma.backupEvent.create({ data: { action: "AUTO_CREATE", fileName: info.fileName, byNik: null } });
    const removed = applyRetention(setting.retentionDays, setting.retentionMaxCount);
    if (removed.length > 0) {
      await prisma.backupEvent.create({
        data: { action: "CLEANUP", fileName: null, byNik: null, note: `Retensi otomatis: ${removed.join(", ")}` },
      });
    }
  } catch (err) {
    console.error("[backup] Auto-backup harian gagal:", err);
  }
}

export function startBackupScheduler() {
  runAutoBackupCheck().catch((err) => console.error("[backup] Pengecekan auto-backup awal gagal:", err));
  setInterval(() => {
    runAutoBackupCheck().catch((err) => console.error("[backup] Pengecekan auto-backup gagal:", err));
  }, CHECK_INTERVAL_MS);
}
