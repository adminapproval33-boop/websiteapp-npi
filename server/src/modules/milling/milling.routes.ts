import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

export const millingRouter = Router();
millingRouter.use(requireAuth);

/// 10 slot bacaan tetap (Fineness/Visco/Suhu); slot kosong tetap dikirim sbg string kosong.
const readings10 = z.array(z.string()).max(10).optional();

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
  iuPlant: z.string().trim().min(1, "IU Plant wajib diisi."),
  codeTanki1: z.string().optional(),
  codeTanki2: z.string().optional(),
  codeMesin: z.string().optional(),
  formReceived: optionalDate,
  start: z.coerce.date({ errorMap: () => ({ message: "Start wajib diisi." }) }),
  finish: z.coerce.date({ errorMap: () => ({ message: "Finish wajib diisi." }) }),
  spvProduksi: z.string().trim().min(1, "SPV Produksi wajib diisi."),
  leader: z.string().optional(),
  members: z.array(z.string()).optional(),
  fineness: readings10,
  visco: readings10,
  suhu: readings10,
  remark: z.string().optional(),
});

/// Data terakhir untuk Order ini di Milling -- dipakai supaya begitu Order
/// yang sama diketik lagi, semua kolom yang sudah pernah diisi langsung muncul.
millingRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.millingLog.findFirst({
      where: { order },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

millingRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.millingLog.findMany({
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

millingRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.millingLog.create({ data: { ...parsed.data, inputBy: req.auth!.nik } });
    res.status(201).json({ success: true, message: "Data Milling berhasil disimpan.", data: created });
  })
);

// Sengaja requireWrite (bukan requireFullAccess) -- Input Milling otomatis
// masuk mode Edit (replace) begitu Order yang sama diketik ulang, jadi user
// ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save. Full Access
// tetap satu-satunya yg boleh Hapus (lihat route DELETE di bawah).
millingRouter.put(
  "/:id",
  requireWrite,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.millingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Milling tidak ditemukan.");

    const updated = await prisma.millingLog.update({ where: { id }, data: parsed.data });
    res.json({ success: true, message: "Data Milling berhasil diperbarui.", data: updated });
  })
);

millingRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.millingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Milling tidak ditemukan.");
    await prisma.millingLog.delete({ where: { id } });
    res.json({ success: true, message: "Data Milling berhasil dihapus." });
  })
);

const upload = createUploader();

millingRouter.post(
  "/:id/attachments",
  requireWrite,
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const logId = Number(req.params.id);
    const log = await prisma.millingLog.findUnique({ where: { id: logId } });
    if (!log) throw new HttpError(404, "Data Milling tidak ditemukan.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.millingAttachment.create({
      data: {
        logId: log.id,
        order: log.order,
        fileName: req.file.originalname,
        filePath: await uploadToBlob("milling", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
