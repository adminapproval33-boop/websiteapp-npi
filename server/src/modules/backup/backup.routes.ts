import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import {
  applyRetention,
  assertSafeFilename,
  backupFilePath,
  createBackup,
  deleteBackup,
  getDiskUsage,
  listBackupFiles,
  restoreBackup,
} from "./backupService";
import { getBlobUsage } from "./blobUsage";

export const backupRouter = Router();

backupRouter.use(requireAuth, requireFullAccess);

/** Restore & Hapus backup MENIMPA/MENGHILANGKAN data produksi secara permanen
 * -- dibatasi ke NIK ini saja (2026-09-08, instruksi eksplisit user: "buatkan
 * sistem backup manajemen"), TIDAK terkait level akses FULL_ACCESS biasa,
 * sama pola dgn ALLOWED_SYNC_NIKS di approval.routes.ts. Frontend (lihat
 * ALLOWED_BACKUP_ADMIN_NIKS di BackupManagementPage.tsx) cuma sembunyikan
 * tombol -- validasi SESUNGGUHNYA tetap di sini krn frontend bisa dilewati. */
const ALLOWED_BACKUP_ADMIN_NIKS = ["000001", "019375", "001475", "012385", "019701"];

function requireBackupAdmin(req: AuthedRequest) {
  if (!ALLOWED_BACKUP_ADMIN_NIKS.includes(req.auth!.nik)) {
    throw new HttpError(403, "Akses ditolak. Aksi ini dibatasi untuk admin backup yang ditunjuk.");
  }
}

async function logEvent(action: "CREATE" | "AUTO_CREATE" | "RESTORE" | "DELETE" | "CLEANUP", fileName: string | null, byNik: string | null, note?: string) {
  await prisma.backupEvent.create({ data: { action, fileName, byNik, note } });
}

backupRouter.get(
  "/list",
  asyncRoute(async (_req, res) => {
    res.json({ success: true, data: listBackupFiles() });
  })
);

backupRouter.get(
  "/storage",
  asyncRoute(async (_req, res) => {
    const [disk, blob] = await Promise.all([getDiskUsage(), getBlobUsage()]);
    res.json({ success: true, data: { disk, blob } });
  })
);

backupRouter.get(
  "/events",
  asyncRoute(async (_req, res) => {
    const events = await prisma.backupEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ success: true, data: events });
  })
);

const createSchema = z.object({ label: z.string().trim().max(40).optional() });

backupRouter.post(
  "/create",
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Label backup tidak valid." });
      return;
    }
    const info = await createBackup(parsed.data.label ?? "manual");
    await logEvent("CREATE", info.fileName, req.auth!.nik);

    const setting = await getOrCreateSetting();
    const removed = applyRetention(setting.retentionDays, setting.retentionMaxCount);
    if (removed.length > 0) {
      await logEvent("CLEANUP", null, null, `Retensi otomatis setelah backup baru: ${removed.join(", ")}`);
    }

    res.status(201).json({ success: true, message: "Backup berhasil dibuat.", data: info });
  })
);

backupRouter.get(
  "/download/:fileName",
  asyncRoute(async (req, res) => {
    const fileName = String(req.params.fileName);
    assertSafeFilename(fileName);
    const filePath = backupFilePath(fileName);
    res.download(filePath, fileName);
  })
);

backupRouter.delete(
  "/:fileName",
  asyncRoute(async (req: AuthedRequest, res) => {
    requireBackupAdmin(req);
    const fileName = String(req.params.fileName);
    deleteBackup(fileName);
    await logEvent("DELETE", fileName, req.auth!.nik);
    res.json({ success: true, message: "File backup berhasil dihapus." });
  })
);

const restoreSchema = z.object({ confirmFileName: z.string().trim().min(1) });

backupRouter.post(
  "/restore/:fileName",
  asyncRoute(async (req: AuthedRequest, res) => {
    requireBackupAdmin(req);
    const fileName = String(req.params.fileName);
    const parsed = restoreSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.confirmFileName !== fileName) {
      res.status(400).json({
        success: false,
        message: "Konfirmasi tidak sesuai. Ketik ulang persis nama file backup yang ingin dipulihkan.",
      });
      return;
    }

    // Jaring pengaman: buat 1 backup "pre-restore" dari kondisi SAAT INI dulu
    // sebelum menimpa database, supaya restore yang salah pilih file tetap
    // bisa dibatalkan (2026-09-08, instruksi eksplisit user).
    const safetySnapshot = await createBackup("pre-restore-safety");
    await logEvent("CREATE", safetySnapshot.fileName, null, `Snapshot otomatis sebelum restore ke "${fileName}"`);

    await restoreBackup(fileName);
    await logEvent("RESTORE", fileName, req.auth!.nik);

    res.json({
      success: true,
      message: `Database berhasil dipulihkan dari "${fileName}". Snapshot kondisi sebelumnya disimpan sebagai "${safetySnapshot.fileName}".`,
    });
  })
);

backupRouter.post(
  "/cleanup",
  asyncRoute(async (req: AuthedRequest, res) => {
    requireBackupAdmin(req);
    const setting = await getOrCreateSetting();
    const removed = applyRetention(setting.retentionDays, setting.retentionMaxCount);
    if (removed.length > 0) {
      await logEvent("CLEANUP", null, req.auth!.nik, `Manual: ${removed.join(", ")}`);
    }
    res.json({ success: true, message: `${removed.length} file backup lama dihapus.`, data: { removed } });
  })
);

async function getOrCreateSetting() {
  return prisma.backupSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

backupRouter.get(
  "/settings",
  asyncRoute(async (_req, res) => {
    const setting = await getOrCreateSetting();
    res.json({ success: true, data: setting });
  })
);

const settingsSchema = z.object({
  autoBackupEnabled: z.boolean(),
  autoBackupHour: z.number().int().min(0).max(23),
  retentionDays: z.number().int().min(0).max(3650),
  retentionMaxCount: z.number().int().min(0).max(3650),
});

backupRouter.put(
  "/settings",
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const setting = await prisma.backupSetting.upsert({
      where: { id: "singleton" },
      update: { ...parsed.data, updatedByNik: req.auth!.nik },
      create: { id: "singleton", ...parsed.data, updatedByNik: req.auth!.nik },
    });
    res.json({ success: true, message: "Pengaturan backup berhasil disimpan.", data: setting });
  })
);
