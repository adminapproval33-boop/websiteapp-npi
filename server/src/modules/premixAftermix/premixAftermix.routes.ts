import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToR2 } from "../../lib/uploadStorage";

export const premixAftermixRouter = Router();
premixAftermixRouter.use(requireAuth);

const sectionEnum = z.enum(["PREMIX", "AFTERMIX"]);

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya di database -- Prisma
// `update()` menganggap `undefined` sebagai "jangan ubah field ini", jadi
// kalau di-transform ke undefined nilai lama malah tetap nyangkut.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z.object({
  section: sectionEnum,
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().trim().min(1, "Batch wajib diisi."),
  orderQty: z.string().optional(),
  plant: z.string().optional(),
  iuPlant: z.string().trim().min(1, "IU Plant wajib diisi."),
  spvProduksi: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
  members: z.array(z.string()).optional(),
  qtyPerMan: z.string().optional(),
  start: z.coerce.date({ errorMap: () => ({ message: "Start wajib diisi." }) }),
  leader: z.string().optional(),
  finish: z.coerce.date({ errorMap: () => ({ message: "Finish wajib diisi." }) }),
  codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
  formReceived: optionalDate,
  remark: z.string().optional(),
});

/// Data terakhir untuk Order ini DI MODUL/SECTION YANG SAMA (bukan lintas
/// modul seperti /master-data/order-context) -- dipakai supaya begitu Order
/// yang sama diketik lagi di modul yang sama, semua kolom yang sudah pernah
/// diisi (SPV Produksi, Leader, Member, Start, Finish, dst) langsung muncul.
premixAftermixRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const section = sectionEnum.safeParse(req.query.section);
    const latest = await prisma.premixAftermixLog.findFirst({
      where: { order, ...(section.success ? { section: section.data } : {}) },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

premixAftermixRouter.get(
  "/history",
  asyncRoute(async (req, res) => {
    const section = sectionEnum.safeParse(req.query.section);
    const rows = await prisma.premixAftermixLog.findMany({
      where: section.success ? { section: section.data } : undefined,
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

premixAftermixRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.premixAftermixLog.create({
      data: { ...parsed.data, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data berhasil disimpan.", data: created });
  })
);

// Sengaja requireWrite (bukan requireFullAccess) -- Input Premix/Aftermix
// otomatis masuk mode Edit (replace) begitu Order yang sama diketik ulang,
// jadi user ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save.
// Full Access tetap satu-satunya yg boleh Hapus (lihat route DELETE di bawah).
premixAftermixRouter.put(
  "/:id",
  requireWrite,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.premixAftermixLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");

    const updated = await prisma.premixAftermixLog.update({ where: { id }, data: parsed.data });
    res.json({ success: true, message: "Data berhasil diperbarui.", data: updated });
  })
);

premixAftermixRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.premixAftermixLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.premixAftermixLog.delete({ where: { id } });
    res.json({ success: true, message: "Data berhasil dihapus." });
  })
);

const upload = createUploader();

premixAftermixRouter.post(
  "/:id/attachments",
  requireWrite,
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const logId = Number(req.params.id);
    const log = await prisma.premixAftermixLog.findUnique({ where: { id: logId } });
    if (!log) throw new HttpError(404, "Data Premix/Aftermix tidak ditemukan.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.premixAftermixAttachment.create({
      data: {
        logId: log.id,
        section: log.section,
        order: log.order,
        fileName: req.file.originalname,
        filePath: await uploadToR2("premix-aftermix", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
