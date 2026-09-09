import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { env } from "../../lib/env";
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
import {
  AdvancedCategory,
  buildExportWorkbook,
  categoryTableSummary,
  commitImport,
  CommitResult,
  parseImportWorkbook,
  previewImport,
  tablesForCategories,
} from "./advancedDataService";

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

async function logEvent(
  action: "CREATE" | "AUTO_CREATE" | "RESTORE" | "DELETE" | "CLEANUP" | "EXPORT_ADVANCED" | "IMPORT_ADVANCED",
  fileName: string | null,
  byNik: string | null,
  note?: string
) {
  await prisma.backupEvent.create({ data: { action, fileName, byNik, note } });
}

// Sama batas ukuran dgn import Master Data (env.maxImportMb) -- file Import
// Advance bisa mencakup PULUHAN ribu baris lintas tabel sekaligus.
const advancedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxImportMb * 1024 * 1024 },
});

const ALL_CATEGORIES: AdvancedCategory[] = ["master", "transaksi", "qc_approval", "sosial"];

function parseCategories(raw: unknown): AdvancedCategory[] {
  const list = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = list.filter((c) => !ALL_CATEGORIES.includes(c as AdvancedCategory));
  if (list.length === 0 || invalid.length > 0) {
    throw new HttpError(400, `Kategori tidak valid: ${invalid.join(", ") || "(kosong)"}.`);
  }
  return list as AdvancedCategory[];
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

// ---------------------------------------------------------------------------
// Import & Export Data (Advance) -- lihat komentar lengkap di advancedDataService.ts.
// Export: siapa saja FULL_ACCESS boleh (read-only, sama pola dgn /backup/list).
// Import (commit): DIBATASI ke ALLOWED_BACKUP_ADMIN_NIKS + WAJIB snapshot
// pg_dump pre-import dulu, sama pola persis dgn /backup/restore/:fileName --
// ini juga operasi yang bisa menimpa data produksi dalam jumlah besar.
// ---------------------------------------------------------------------------

backupRouter.get(
  "/advanced/summary",
  asyncRoute(async (_req, res) => {
    const categories = categoryTableSummary();
    const withCounts = await Promise.all(
      categories.map(async (c) => {
        const tables = await Promise.all(
          tablesForCategories([c.category]).map(async (t) => {
            const delegateName = t.model.charAt(0).toLowerCase() + t.model.slice(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const count = await (prisma as any)[delegateName].count();
            return { model: t.model, rows: count };
          })
        );
        return { ...c, tableCounts: tables };
      })
    );
    res.json({ success: true, data: withCounts });
  })
);

backupRouter.get(
  "/advanced/export",
  asyncRoute(async (req: AuthedRequest, res) => {
    const categories = parseCategories(req.query.categories);
    const { workbook, tableCounts } = await buildExportWorkbook(categories, `${req.auth!.name} (${req.auth!.nik})`);
    const totalRows = tableCounts.reduce((sum, t) => sum + t.rows, 0);
    await logEvent("EXPORT_ADVANCED", null, req.auth!.nik, `Kategori: ${categories.join(", ")} (${totalRows} baris, ${tableCounts.length} tabel)`);

    const fileName = `data-export-${categories.join("-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    // Ditulis LANGSUNG ke response stream, tidak pernah ke file sementara di disk.
    await workbook.xlsx.write(res);
    res.end();
  })
);

backupRouter.post(
  "/advanced/import/preview",
  advancedUpload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "File .xlsx wajib diunggah." });
      return;
    }
    const sheets = await parseImportWorkbook(req.file.buffer);
    if (sheets.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada sheet tabel yang dikenali di dalam file ini." });
      return;
    }
    const preview = await previewImport(sheets);
    res.json({ success: true, data: preview });
  })
);

backupRouter.post(
  "/advanced/import/commit",
  advancedUpload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    requireBackupAdmin(req);
    if (!req.file) {
      res.status(400).json({ success: false, message: "File .xlsx wajib diunggah." });
      return;
    }
    const confirmText = String(req.body.confirmText ?? "");
    if (confirmText !== "IMPORT DATA") {
      res.status(400).json({ success: false, message: 'Konfirmasi tidak sesuai. Ketik persis "IMPORT DATA".' });
      return;
    }

    const sheets = await parseImportWorkbook(req.file.buffer);
    if (sheets.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada sheet tabel yang dikenali di dalam file ini." });
      return;
    }

    // Jaring pengaman: snapshot pg_dump kondisi SAAT INI dulu sebelum menulis
    // apa pun (2026-09-09, sama pola dgn /backup/restore/:fileName).
    const safetySnapshot = await createBackup("pre-import-advanced-safety");
    await logEvent("CREATE", safetySnapshot.fileName, null, `Snapshot otomatis sebelum Import Advance oleh ${req.auth!.nik}`);

    const results: CommitResult[] = await commitImport(sheets);
    const totalCreated = results.reduce((s, r) => s + r.created, 0);
    const totalUpdated = results.reduce((s, r) => s + r.updated, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed.length, 0);
    await logEvent(
      "IMPORT_ADVANCED",
      null,
      req.auth!.nik,
      `${totalCreated} baru, ${totalUpdated} update, ${totalFailed} gagal, ${results.length} tabel. Snapshot sebelum import: "${safetySnapshot.fileName}".`
    );

    res.json({
      success: true,
      message: `Import selesai: ${totalCreated} baris baru, ${totalUpdated} baris diperbarui${totalFailed > 0 ? `, ${totalFailed} baris gagal (lihat detail)` : ""}. Snapshot kondisi sebelum import disimpan sebagai "${safetySnapshot.fileName}".`,
      data: { results, safetySnapshotFileName: safetySnapshot.fileName },
    });
  })
);
