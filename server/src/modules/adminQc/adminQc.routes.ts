import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

export const adminQcRouter = Router();
adminQcRouter.use(requireAuth);
adminQcRouter.use(requireMenuView("adminQc"));

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya di database.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z
  .object({
    order: z.string().trim().min(1, "Order wajib diisi."),
    materialNumber: z.string().trim().min(1, "Material Number wajib diisi."),
    materialDescription: z.string().trim().min(1, "Material Description wajib diisi."),
    batch: z.string().trim().min(1, "Batch wajib diisi."),
    orderQty: z.string().trim().min(1, "Order Qty wajib diisi."),
    plant: z.string().trim().min(1, "Plant wajib diisi."),
    iuPlant: z.string().trim().min(1, "IU Plant wajib diisi."),
    codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
    typeLot: z.string().trim().min(1, "Admin QC Stage wajib diisi."),
    lotPassed: optionalDate,
    qcToApproval: optionalDate,
    qcPassed: optionalDate,
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Cabang syarat dari pilihan Admin QC Stage -- SAMA PERSIS dgn logika yg
    // dulu ada di approval.routes.ts sebelum Admin QC dipisah jadi tabel &
    // menu sendiri (2026-07-28, sesuai instruksi eksplisit user). "Improve"
    // tidak nambah syarat apa pun di luar baseline (sudah wajib dari Zod di
    // atas).
    const hasLotPassed = data.lotPassed != null;
    const hasQcToApproval = data.qcToApproval != null;
    const hasQcPassed = data.qcPassed != null;

    if (data.typeLot === "Joint Lot" || data.typeLot === "Lot Packing") {
      if (!hasLotPassed) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lotPassed"], message: "Lot Passed wajib diisi kalau Admin QC Stage sudah diisi." });
      if (!hasQcToApproval) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qcToApproval"], message: "QC to App wajib diisi kalau Admin QC Stage sudah diisi." });
      if (!hasQcPassed) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qcPassed"], message: "QC Passed wajib diisi kalau Admin QC Stage sudah diisi." });
    } else if (data.typeLot === "Approval") {
      if (!hasQcToApproval) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qcToApproval"], message: "QC to App wajib diisi kalau Admin QC Stage sudah diisi." });
    }
  });

/// Data terakhir untuk Order ini di Admin QC -- dipakai supaya begitu Order
/// yang sama diketik lagi, semua kolom yang sudah pernah diisi langsung muncul.
adminQcRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const latest = await prisma.adminQc.findFirst({
      where: { order: String(req.params.order).trim() },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

adminQcRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.adminQc.findMany({
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

adminQcRouter.post(
  "/",
  requireWrite,
  requireMenuInput("adminQc"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.adminQc.create({
      data: { ...parsed.data, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data Admin QC berhasil disimpan.", data: created });
  })
);

// Sengaja requireWrite (bukan requireFullAccess) -- Input Admin QC otomatis
// masuk mode Edit (replace) begitu Order yang sama diketik ulang, jadi user
// ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save. Full
// Access tetap satu-satunya yg boleh Hapus (lihat route DELETE di bawah).
adminQcRouter.put(
  "/:adminQcId",
  requireWrite,
  requireMenuInput("adminQc"),
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const adminQcId = req.params.adminQcId;
    const existing = await prisma.adminQc.findUnique({ where: { adminQcId } });
    if (!existing) throw new HttpError(404, "Data Admin QC tidak ditemukan.");

    const updated = await prisma.adminQc.update({ where: { adminQcId }, data: parsed.data });
    res.json({ success: true, message: "Data Admin QC berhasil diperbarui.", data: updated });
  })
);

adminQcRouter.delete(
  "/:adminQcId",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const adminQcId = req.params.adminQcId;
    const existing = await prisma.adminQc.findUnique({ where: { adminQcId } });
    if (!existing) throw new HttpError(404, "Data Admin QC tidak ditemukan.");
    await prisma.adminQc.delete({ where: { adminQcId } });
    res.json({ success: true, message: "Data Admin QC berhasil dihapus." });
  })
);

const upload = createUploader();

adminQcRouter.post(
  "/:adminQcId/attachments",
  requireWrite,
  requireMenuInput("adminQc"),
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const adminQcId = req.params.adminQcId;
    const adminQc = await prisma.adminQc.findUnique({ where: { adminQcId } });
    if (!adminQc) throw new HttpError(404, "Simpan data Admin QC terlebih dahulu sebelum mengunggah lampiran.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.adminQcAttachment.create({
      data: {
        adminQcId,
        fileName: req.file.originalname,
        filePath: await uploadToBlob("admin-qc", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);

adminQcRouter.delete(
  "/:adminQcId/attachments/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const attachment = await prisma.adminQcAttachment.findUnique({ where: { id } });
    if (!attachment || attachment.adminQcId !== req.params.adminQcId) throw new HttpError(404, "Lampiran tidak ditemukan.");
    await prisma.adminQcAttachment.delete({ where: { id } });
    res.json({ success: true, message: "Lampiran berhasil dihapus." });
  })
);
