import { prisma } from "../../lib/prisma";
import { sendMail } from "../../lib/mailer";
import { ALLOWED_BACKUP_ADMIN_NIKS, applyRetention, createBackupWithOffsiteCopy } from "./backupService";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cek tiap 15 menit -- cukup granular utk jadwal per-jam tanpa perlu dependency cron.

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, waktu server
}

/** Kirim email peringatan ke admin backup yg sudah isi Email di Master Data
 * Karyawan (2026-10-04, instruksi eksplisit user: temuan audit "kalau backup
 * otomatis gagal, tidak ada yg diberi tahu") -- pakai daftar NIK yg SAMA
 * dgn yg boleh Restore/Hapus backup (ALLOWED_BACKUP_ADMIN_NIKS), krn merekalah
 * yg perlu tahu & bisa bertindak kalau backup gagal. Diam saja (bukan error)
 * kalau belum ada satupun dari mereka yg isi email -- jangan sampai gagal
 * kirim notifikasi ini menggagalkan apa pun yg lain. */
async function sendBackupFailureAlert(errorMessage: string): Promise<void> {
  const admins = await prisma.masterEmployee.findMany({
    where: { employeeId: { in: ALLOWED_BACKUP_ADMIN_NIKS }, email: { not: null } },
    select: { email: true },
  });
  const recipients = admins.map((a) => a.email).filter((e): e is string => !!e);
  if (recipients.length === 0) return;
  await sendMail({
    to: recipients,
    subject: "[MES NPI] Backup Database Otomatis Gagal",
    html: `<p>Backup database otomatis hari ini gagal dengan pesan:</p><pre style="background:#f5f5f5;padding:10px;border-radius:6px;white-space:pre-wrap;">${errorMessage}</pre><p>Mohon dicek segera -- menu Developer Tools &gt; Backup &amp; Storage.</p>`,
  });
}

/** Backup otomatis harian, tanpa dependency cron eksternal -- cukup polling
 * ringan tiap 15 menit (2026-09-08, instruksi eksplisit user: "sistem backup
 * manajemen"). Jalan cuma SEKALI per hari per jam yang dikonfigurasi,
 * dicek lewat ada/tidaknya BackupEvent AUTO_CREATE hari ini supaya aman
 * walau server di-restart berkali-kali dalam 1 hari yang sama.
 *
 * 2026-10-04, instruksi eksplisit user (temuan audit): sebelumnya syaratnya
 * `now.getHours() !== autoBackupHour` -- kalau server kebetulan mati PERSIS
 * di jam itu, backup hari itu lewat begitu saja tanpa ada yg "menyusul".
 * Sekarang `<` -- begitu jam saat ini SUDAH LEWAT (atau PAS) jam yg
 * dikonfigurasi DAN belum ada AUTO_CREATE hari ini, backup tetap jalan di
 * poll berikutnya, kapan pun server itu nyala lagi hari yg sama. */
async function runAutoBackupCheck() {
  const setting = await prisma.backupSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  if (!setting.autoBackupEnabled) return;

  const now = new Date();
  if (now.getHours() < setting.autoBackupHour) return;

  const alreadyRanToday = await prisma.backupEvent.findFirst({
    where: {
      action: { in: ["AUTO_CREATE", "AUTO_CREATE_FAILED"] },
      createdAt: { gte: new Date(`${todayKey()}T00:00:00`) },
    },
  });
  if (alreadyRanToday) return;

  try {
    const { info, blobPath } = await createBackupWithOffsiteCopy("auto");
    await prisma.backupEvent.create({ data: { action: "AUTO_CREATE", fileName: info.fileName, byNik: null, blobPath } });
    const removed = await applyRetention(setting.retentionDays, setting.retentionMaxCount);
    if (removed.length > 0) {
      await prisma.backupEvent.create({
        data: { action: "CLEANUP", fileName: null, byNik: null, note: `Retensi otomatis: ${removed.join(", ")}` },
      });
    }
  } catch (err) {
    console.error("[backup] Auto-backup harian gagal:", err);
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.backupEvent.create({
        data: { action: "AUTO_CREATE_FAILED", fileName: null, byNik: null, note: message.slice(0, 1000) },
      });
    } catch (logErr) {
      console.error("[backup] Gagal mencatat AUTO_CREATE_FAILED:", logErr);
    }
    await sendBackupFailureAlert(message).catch((mailErr) => console.error("[backup] Gagal kirim email peringatan:", mailErr));
  }
}

export function startBackupScheduler() {
  runAutoBackupCheck().catch((err) => console.error("[backup] Pengecekan auto-backup awal gagal:", err));
  setInterval(() => {
    runAutoBackupCheck().catch((err) => console.error("[backup] Pengecekan auto-backup gagal:", err));
  }, CHECK_INTERVAL_MS);
}
