import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToR2 } from "../../lib/uploadStorage";

export const colourMatchingRouter = Router();
colourMatchingRouter.use(requireAuth);

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya di database -- Prisma
// `update()` menganggap `undefined` sebagai "jangan ubah field ini", jadi
// kalau di-transform ke undefined nilai lama malah tetap nyangkut.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z
  .object({
    order: z.string().trim().min(1, "Order wajib diisi."),
    materialNumber: z.string().optional(),
    materialDescription: z.string().optional(),
    batch: z.string().trim().min(1, "Batch wajib diisi."),
    orderQty: z.string().optional(),
    plant: z.string().optional(),
    iuPlant: z.string().optional(),
    codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
    typesOfProducts: z.string().trim().min(1, "Types of Products wajib diisi."),
    baseColor: z.string().trim().min(1, "Base Color wajib diisi."),
    formPerMan: z.string().optional(),
    formReceived: z.coerce.date({ errorMap: () => ({ message: "Form Received wajib diisi." }) }),
    start: optionalDate,
    finish: optionalDate,
    spvName: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
    leaderName: z.string().trim().min(1, "Nama Leader wajib diisi."),
    members: z.array(z.string()).optional(),
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Member & Start wajib bareng (proses baru dianggap "mulai" begitu ada
    // anggota + waktu mulai). Finish TIDAK ikut wajib bareng -- boleh
    // menyusul belakangan (alur "mulai dulu, selesaikan nanti" lewat Edit),
    // supaya status "Proses Colour Matching" (Start terisi, Finish belum)
    // di dashboard bisa benar-benar tercapai. Finish hanya boleh diisi kalau
    // Start juga sudah diisi (tidak logis selesai sebelum mulai).
    const hasMembers = (data.members?.length ?? 0) > 0;
    const hasStart = data.start != null;
    const hasFinish = data.finish != null;
    if (hasMembers || hasStart) {
      if (!hasMembers) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["members"], message: "Member wajib diisi kalau Start sudah diisi." });
      if (!hasStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["start"], message: "Start wajib diisi kalau Member sudah diisi." });
    }
    if (hasFinish && !hasStart) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finish"], message: "Finish hanya boleh diisi kalau Start sudah diisi." });
    }
  });

/// Data terakhir untuk Order ini di Colour Matching -- dipakai supaya begitu
/// Order yang sama diketik lagi, semua kolom yang sudah pernah diisi langsung muncul.
colourMatchingRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.colourMatchingLog.findFirst({
      where: { order },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

colourMatchingRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.colourMatchingLog.findMany({
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

colourMatchingRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.colourMatchingLog.create({
      data: { ...parsed.data, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data Colour Matching berhasil disimpan.", data: created });
  })
);

// Sengaja requireWrite (bukan requireFullAccess) -- Input Data Colour Matching
// otomatis masuk mode Edit (replace) begitu Order yang sama diketik ulang,
// jadi user ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save.
// Full Access tetap satu-satunya yg boleh Hapus (lihat route DELETE di bawah).
colourMatchingRouter.put(
  "/:id",
  requireWrite,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.colourMatchingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Colour Matching tidak ditemukan.");

    const updated = await prisma.colourMatchingLog.update({ where: { id }, data: parsed.data });
    res.json({ success: true, message: "Data Colour Matching berhasil diperbarui.", data: updated });
  })
);

colourMatchingRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.colourMatchingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Colour Matching tidak ditemukan.");
    await prisma.colourMatchingLog.delete({ where: { id } });
    res.json({ success: true, message: "Data Colour Matching berhasil dihapus." });
  })
);

const upload = createUploader();

colourMatchingRouter.post(
  "/:id/attachments",
  requireWrite,
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const logId = Number(req.params.id);
    const log = await prisma.colourMatchingLog.findUnique({ where: { id: logId } });
    if (!log) throw new HttpError(404, "Data Colour Matching tidak ditemukan.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.colourMatchingAttachment.create({
      data: {
        logId: log.id,
        order: log.order,
        fileName: req.file.originalname,
        filePath: await uploadToR2("colour-matching", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
