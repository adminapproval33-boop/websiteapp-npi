import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";
import { sanitizeNik } from "../../lib/employeeNik";

/**
 * Menu "Maintenance" (2026-08-06, instruksi eksplisit user) -- dipicu dari
 * checkbox "Damaged" di Master Data > Tanki, tapi form ini berdiri sendiri
 * (codeTanki BUKAN foreign key, pola sama dgn modul produksi lain). 3
 * sub-menu berbagi endpoint yg sama: "Form Input Maintenance" (POST/PUT di
 * sini), "List Job Maintenance" (GET /history, status dihitung dari field
 * mana yg terisi -- lihat computeStatus), "Jadwal Pengerjaan" (kalender
 * drag-drop day+sequence, pola SAMA PERSIS dgn PWO Schedule di
 * premixAftermix.routes.ts, tapi jadwalnya nempel langsung di baris Job
 * ini sendiri -- lihat komentar model MaintenanceLog di schema.prisma).
 *
 * PENTING soal urutan route Express: rute literal (/history, /schedule,
 * /reorder) HARUS didaftarkan SEBELUM rute wildcard senilai (/:id) yg
 * segment-count-nya sama -- kalau tidak, "/history" dkk ketangkep duluan
 * oleh "/:id" (id="history") dan salah eksekusi. Semua GET "/:id" & PUT
 * "/:id" sengaja ditaruh PALING BAWAH di grup method masing2.
 */
export const maintenanceRouter = Router();
maintenanceRouter.use(requireAuth);
maintenanceRouter.use(requireMenuView("maintenance"));

const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z
  .object({
    codeTanki: z.string().trim().min(1, "Code Tanki/Objek wajib diisi."),
    description: z.string().trim().min(1, "Deskripsi Kerusakan wajib diisi."),
    reportedBy: z.string().trim().min(1, "Pelapor wajib diisi."),
    reportedByNik: z.string().trim().optional().nullable(),
    priority: z.string().optional(),
    technician: z.string().optional(),
    technicianNik: z.string().trim().optional().nullable(),
    scheduledDate: optionalDate,
    start: optionalDate,
    finish: optionalDate,
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Cascading INTERNAL ke form ini sendiri (BUKAN dependensi ke proses/tim
    // lain, sama semangat dgn revisi Approval 2026-08-06 -- lihat catatan di
    // approval.routes.ts): tidak masuk akal Mulai Pengerjaan terisi sebelum
    // Jadwal Pengerjaan, atau Selesai terisi sebelum Mulai Pengerjaan.
    if (data.start != null && data.scheduledDate == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["start"], message: "Jadwal Pengerjaan wajib diisi kalau Tanggal Mulai sudah diisi." });
    }
    if (data.finish != null && data.start == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finish"], message: "Tanggal Mulai wajib diisi kalau Tanggal Selesai sudah diisi." });
    }
  });

type StatusVerdict = "Pending" | "Dijadwalkan" | "Dikerjakan" | "Selesai";
function computeStatus(row: { scheduledDate: Date | null; start: Date | null; finish: Date | null }): StatusVerdict {
  if (row.finish) return "Selesai";
  if (row.start) return "Dikerjakan";
  if (row.scheduledDate) return "Dijadwalkan";
  return "Pending";
}

// ===================== GET (literal routes dulu, /:id PALING BAWAH) =====================

/// Data terakhir utk Code Tanki ini -- autofill spt modul lain begitu Code
/// Tanki yg sama diketik ulang (mis. dari redirect checkbox Damaged berkali2).
maintenanceRouter.get(
  "/latest-by-tank/:codeTanki",
  asyncRoute(async (req, res) => {
    const codeTanki = String(req.params.codeTanki).trim();
    const latest = await prisma.maintenanceLog.findFirst({ where: { codeTanki }, orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: latest });
  })
);

maintenanceRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.maintenanceLog.findMany({
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows.map((r) => ({ ...r, status: computeStatus(r) })) });
  })
);

/// "Jadwal Pengerjaan": Job yg BELUM Selesai (finish null) -- kalender di
/// frontend memisahkan jadi kolom hari vs strip "Belum Dijadwalkan"
/// (scheduledDate null), sama pola dgn PWO Schedule yg membedakan Queue vs
/// kartu terjadwal dari 1 response yg sama.
maintenanceRouter.get(
  "/schedule",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.maintenanceLog.findMany({
      where: { finish: null },
      orderBy: [{ scheduledDate: "asc" }, { sequence: "asc" }],
    });
    res.json({ success: true, data: rows });
  })
);

/// Dipakai deep-link "Edit" dari List Job Maintenance -> Form Input
/// Maintenance (halaman/rute TERPISAH, beda dari modul lain yg tab Input +
/// History ada di 1 komponen yg sama).
maintenanceRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const row = await prisma.maintenanceLog.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "Data Maintenance tidak ditemukan.");
    res.json({ success: true, data: { ...row, status: computeStatus(row) } });
  })
);

// ===================== POST =====================

maintenanceRouter.post(
  "/",
  requireWrite,
  requireMenuInput("maintenance"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const [reportedByNik, technicianNik] = await Promise.all([
      sanitizeNik(parsed.data.reportedByNik),
      sanitizeNik(parsed.data.technicianNik),
    ]);
    const created = await prisma.maintenanceLog.create({
      data: { ...parsed.data, reportedByNik, technicianNik, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data Maintenance berhasil disimpan.", data: created });
  })
);

const upload = createUploader();

maintenanceRouter.post(
  "/:id/attachments",
  requireWrite,
  requireMenuInput("maintenance"),
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const logId = Number(req.params.id);
    const log = await prisma.maintenanceLog.findUnique({ where: { id: logId } });
    if (!log) throw new HttpError(404, "Data Maintenance tidak ditemukan.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.maintenanceAttachment.create({
      data: {
        logId: log.id,
        codeTanki: log.codeTanki,
        fileName: req.file.originalname,
        filePath: await uploadToBlob("maintenance", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);

// ===================== PUT (literal routes dulu, /:id PALING BAWAH) =====================

/// Drag kartu ke kolom hari di "Jadwal Pengerjaan" -- set scheduledDate,
/// sequence otomatis di-append ke paling bawah hari target (sama pola dgn
/// POST /pwo-schedule di premixAftermix.routes.ts).
const scheduleSchema = z.object({ scheduledDate: z.coerce.date() });
maintenanceRouter.put(
  "/:id/schedule",
  requireWrite,
  requireMenuInput("maintenance"),
  asyncRoute(async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Tanggal tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.maintenanceLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Maintenance tidak ditemukan.");

    const maxSeq = await prisma.maintenanceLog.aggregate({
      where: { scheduledDate: parsed.data.scheduledDate },
      _max: { sequence: true },
    });
    const sequence = (maxSeq._max.sequence ?? -1) + 1;
    const updated = await prisma.maintenanceLog.update({ where: { id }, data: { scheduledDate: parsed.data.scheduledDate, sequence } });
    res.json({ success: true, message: "Jadwal berhasil disimpan.", data: updated });
  })
);

/// Reorder drag-drop DALAM 1 hari yg sama -- klien kirim urutan ID final utk
/// 1 hari sekaligus, sama pola dgn PUT /pwo-schedule/reorder. Path
/// "/reorder" HARUS didaftarkan SEBELUM "/:id" di bawah (segment count sama,
/// 1 segment) -- kalau tidak, "/reorder" ketangkep "/:id" (id="reorder").
const reorderSchema = z.object({ scheduledDate: z.coerce.date(), orderedIds: z.array(z.number()).min(1) });
maintenanceRouter.put(
  "/reorder",
  requireWrite,
  requireMenuInput("maintenance"),
  asyncRoute(async (req, res) => {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const { scheduledDate, orderedIds } = parsed.data;
    await prisma.$transaction(
      orderedIds.map((id, index) => prisma.maintenanceLog.updateMany({ where: { id, scheduledDate }, data: { sequence: index } }))
    );
    res.json({ success: true, message: "Urutan berhasil disimpan." });
  })
);

maintenanceRouter.put(
  "/:id",
  requireWrite,
  requireMenuInput("maintenance"),
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.maintenanceLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Maintenance tidak ditemukan.");

    const [reportedByNik, technicianNik] = await Promise.all([
      sanitizeNik(parsed.data.reportedByNik),
      sanitizeNik(parsed.data.technicianNik),
    ]);
    const updated = await prisma.maintenanceLog.update({
      where: { id },
      data: { ...parsed.data, reportedByNik, technicianNik },
    });
    res.json({ success: true, message: "Data Maintenance berhasil diperbarui.", data: updated });
  })
);

// ===================== DELETE =====================

maintenanceRouter.delete(
  "/:id/attachments/:attachmentId",
  requireMenuInput("maintenance"),
  asyncRoute(async (req, res) => {
    const attachmentId = Number(req.params.attachmentId);
    const existing = await prisma.maintenanceAttachment.findUnique({ where: { id: attachmentId } });
    if (!existing) throw new HttpError(404, "Lampiran tidak ditemukan.");
    await prisma.maintenanceAttachment.delete({ where: { id: attachmentId } });
    res.json({ success: true, message: "Lampiran berhasil dihapus." });
  })
);

maintenanceRouter.delete(
  "/:id",
  requireMenuInput("maintenance"),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.maintenanceLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Maintenance tidak ditemukan.");
    await prisma.maintenanceLog.delete({ where: { id } });
    res.json({ success: true, message: "Data Maintenance berhasil dihapus." });
  })
);
