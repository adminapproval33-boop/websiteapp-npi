import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";
import { hasAdminQcQcPassed } from "../../lib/stageGate";

export const packingRouter = Router();
packingRouter.use(requireAuth);

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya di database.
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
    spvName: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
    members: z.array(z.string()).optional(),
    formReceived: optionalDate,
    start: optionalDate,
    leaderName: z.string().optional(),
    qtyPerMan: z.string().optional(),
    totalQty: z.string().optional(),
    qtyPcs: z.string().optional(),
    finish: optionalDate,
    codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Member wajib diisi begitu Start ATAU Finish sudah diisi -- sesuai
    // instruksi eksplisit user (2026-07-29).
    const hasMembers = Array.isArray(data.members) && data.members.length > 0;
    if ((data.start != null || data.finish != null) && !hasMembers) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["members"], message: "Member wajib diisi kalau Start atau Finish sudah diisi." });
    }
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

// ===================== List Antrian Packing =====================

/** Order yg Admin QC Stage TERBARUnya sudah punya QC Passed terisi (lihat
 * modules/adminQc), dan BELUM PERNAH diinput ke Packing -- ini yg dipakai
 * menu "List Antrian Packing" (2026-07-29, sesuai instruksi eksplisit user).
 * Order otomatis hilang dari daftar ini begitu sudah ada input Packing utk
 * Order tersebut. Pola sama persis dgn PWO Schedule & Queue di Milling/
 * Aftermix/Colour Matching dan List Antrian Approval (lihat
 * modules/milling/milling.routes.ts, modules/approval/approval.routes.ts). */
packingRouter.get(
  "/queue",
  asyncRoute(async (_req, res) => {
    const [adminQcRows, packingOrders] = await Promise.all([
      prisma.adminQc.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    const packingOrderSet = new Set(packingOrders.map((r) => r.order));

    // Dedupe ke Admin QC Stage PALING TERAKHIR per Order (baris pertama yg
    // ditemui, krn adminQcRows sudah diurutkan timestamp desc).
    const latestByOrder = new Map<string, (typeof adminQcRows)[number]>();
    for (const r of adminQcRows) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }

    const queueRows = Array.from(latestByOrder.values()).filter((r) => r.qcPassed != null && !packingOrderSet.has(r.order));
    queueRows.sort((a, b) => a.qcPassed!.getTime() - b.qcPassed!.getTime());

    const uniqueOrders = queueRows.map((r) => r.order);
    const masterOrders = await prisma.masterOrder.findMany({
      where: { order: { in: uniqueOrders } },
      select: { order: true, materialNumber: true, materialDescription: true, batch: true, orderQty: true, plant: true },
    });
    const masterByOrder = new Map(masterOrders.map((m) => [m.order, m]));

    const data = queueRows.map((r) => {
      const master = masterByOrder.get(r.order);
      return {
        order: r.order,
        materialNumber: master?.materialNumber ?? r.materialNumber,
        materialDescription: master?.materialDescription ?? r.materialDescription,
        batch: master?.batch ?? r.batch,
        orderQty: master?.orderQty ?? r.orderQty,
        plant: master?.plant ?? r.plant,
        iuPlant: r.iuPlant,
        codeTanki: r.codeTanki,
        typeLot: r.typeLot,
        lotPassed: r.lotPassed,
        qcToApproval: r.qcToApproval,
        qcPassed: r.qcPassed,
        remark: r.remark,
      };
    });

    res.json({ success: true, data });
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
    // Urutan tahap baku (2026-07-31, instruksi eksplisit bos user): Packing
    // wajib utk semua proses -- baru boleh diinput kalau Order ini sudah
    // py QC Passed di Admin QC (sama syarat dgn "List Antrian Packing").
    // Baris BARU saja (PUT/Edit tetap bebas).
    if (!(await hasAdminQcQcPassed(parsed.data.order))) {
      res.status(400).json({
        success: false,
        message: `Order ${parsed.data.order} belum QC Passed di Admin QC -- tidak bisa diinput ke Packing dulu.`,
      });
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
        filePath: await uploadToBlob("packing", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
