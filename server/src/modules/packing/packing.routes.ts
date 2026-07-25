import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToR2 } from "../../lib/uploadStorage";

export const packingRouter = Router();
packingRouter.use(requireAuth);

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya di database.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().trim().min(1, "Batch wajib diisi."),
  orderQty: z.string().optional(),
  plant: z.string().optional(),
  iuPlant: z.string().optional(),
  spvName: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
  members: z.array(z.string()).optional(),
  formReceived: optionalDate,
  start: optionalDate,
  leaderName: z.string().optional(),
  qtyPerMan: z.string().optional(),
  totalQty: z.string().optional(),
  finish: optionalDate,
  codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
  remark: z.string().optional(),
});

/// Data terakhir untuk Order ini di Packing -- dipakai supaya begitu Order
/// yang sama diketik lagi, semua kolom yang sudah pernah diisi langsung muncul.
packingRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.packingLog.findFirst({
      where: { order },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

packingRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.packingLog.findMany({
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

packingRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.packingLog.create({
      data: { ...parsed.data, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data Packing berhasil disimpan.", data: created });
  })
);

// Sengaja requireWrite (bukan requireFullAccess) -- Input Packing otomatis
// masuk mode Edit (replace) begitu Order yang sama diketik ulang, jadi user
// ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save. Full Access
// tetap satu-satunya yg boleh Hapus (lihat route DELETE di bawah).
packingRouter.put(
  "/:id",
  requireWrite,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.packingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Packing tidak ditemukan.");

    const updated = await prisma.packingLog.update({ where: { id }, data: parsed.data });
    res.json({ success: true, message: "Data Packing berhasil diperbarui.", data: updated });
  })
);

packingRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.packingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Packing tidak ditemukan.");
    await prisma.packingLog.delete({ where: { id } });
    res.json({ success: true, message: "Data Packing berhasil dihapus." });
  })
);

const upload = createUploader();

packingRouter.post(
  "/:id/attachments",
  requireWrite,
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const logId = Number(req.params.id);
    const log = await prisma.packingLog.findUnique({ where: { id: logId } });
    if (!log) throw new HttpError(404, "Data Packing tidak ditemukan.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.packingAttachment.create({
      data: {
        logId: log.id,
        order: log.order,
        fileName: req.file.originalname,
        filePath: await uploadToR2("packing", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
