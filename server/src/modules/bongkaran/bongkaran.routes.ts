import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";
import { sanitizeNik, sanitizeMembers } from "../../lib/employeeNik";
import { notFutureDate } from "../../lib/dateValidation";

export const bongkaranRouter = Router();
bongkaranRouter.use(requireAuth);
bongkaranRouter.use(requireMenuView("bongkaran"));

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya -- sama pola dgn
// colourMatching.routes.ts.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

/**
 * Validasi SENGAJA longgar (Order + SPV Produksi saja yg wajib) -- Bongkaran
 * TIDAK terhubung ke Master Data > Material Flow Proses/stageGate.ts sama
 * sekali (lihat catatan di schema.prisma), jadi tidak ada prasyarat tahap
 * sebelumnya yg dicek di sini, dan field identitas Order (Material Number/
 * Description/Batch/Qty/Plant) dibiarkan opsional -- pola sama dgn
 * productionOrderManualInput.routes.ts, bukan pola ketat modul tahap lain.
 */
const saveSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  orderQty: z.string().optional(),
  plant: z.string().optional(),
  spvName: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
  spvNik: z.string().trim().optional().nullable(),
  leaderName: z.string().optional(),
  leaderNik: z.string().trim().optional().nullable(),
  members: z
    .array(z.object({ name: z.string().trim().min(1), nik: z.string().trim().optional().nullable() }))
    .optional(),
  formReceived: notFutureDate(optionalDate, "Form Received"),
  /// Milestone "Selesai" tahap ini -- begitu terisi, kolom "Proses" di
  /// Production Order Monitoring berubah jadi "Produksi - PQE" (lihat
  /// bongkaranProcessLabel di dashboard.routes.ts).
  sendToPqe: notFutureDate(optionalDate, "Send To PQE"),
  remark: z.string().optional(),
});

/// Data terakhir utk Order ini -- autofill spt modul lain begitu Order yg
/// sama diketik ulang.
bongkaranRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.bongkaranLog.findFirst({ where: { order }, orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: latest });
  })
);

/**
 * "PWO Schedule & Queue": Order yg Colour Matching-nya sudah "-DN" tapi
 * BELUM py baris BongkaranLog sama sekali. BEDA dari antrian modul lain:
 * TIDAK ada syarat "Material Number PERNAH py histori Bongkaran" krn tahap
 * ini tidak digerakkan oleh MaterialFlow sama sekali -- semua Order yg
 * Colour Matching-nya selesai otomatis kandidat.
 */
bongkaranRouter.get(
  "/pwo-queue",
  asyncRoute(async (_req, res) => {
    const [colourMatchingLogs, bongkaranLogs, approvalOrders, packingOrders] = await Promise.all([
      prisma.colourMatchingLog.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.bongkaranLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    const bongkaranOrderSet = new Set(bongkaranLogs.map((r) => r.order));
    const pastOrderSet = new Set([...approvalOrders.map((r) => r.order), ...packingOrders.map((r) => r.order)]);

    const latestColourMatchingByOrder = new Map<string, (typeof colourMatchingLogs)[number]>();
    for (const r of colourMatchingLogs) {
      if (!latestColourMatchingByOrder.has(r.order)) latestColourMatchingByOrder.set(r.order, r);
    }

    const isColourMatchingDone = (r: { formReceived: Date | null; start: Date | null; finish: Date | null }) =>
      Boolean(r.finish && r.start && r.formReceived);

    const queueRows = Array.from(latestColourMatchingByOrder.values()).filter(
      (r) => isColourMatchingDone(r) && !bongkaranOrderSet.has(r.order) && !pastOrderSet.has(r.order)
    );
    queueRows.sort((a, b) => a.finish!.getTime() - b.finish!.getTime());

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
        finish: r.finish,
        remark: r.remark,
      };
    });

    res.json({ success: true, data });
  })
);

bongkaranRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.bongkaranLog.findMany({
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

bongkaranRouter.post(
  "/",
  requireWrite,
  requireMenuInput("bongkaran"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const [spvNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const created = await prisma.bongkaranLog.create({
      data: { ...parsed.data, spvNik, leaderNik, members: members as unknown as Prisma.InputJsonValue, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data Bongkaran berhasil disimpan.", data: created });
  })
);

// requireWrite (bukan requireFullAccess) -- sama pola dgn Colour Matching:
// begitu Order yg sama diketik ulang, form otomatis masuk mode Edit, jadi
// user ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save.
bongkaranRouter.put(
  "/:id",
  requireWrite,
  requireMenuInput("bongkaran"),
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.bongkaranLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Bongkaran tidak ditemukan.");

    const [spvNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const updated = await prisma.bongkaranLog.update({
      where: { id },
      data: { ...parsed.data, spvNik, leaderNik, members: members as unknown as Prisma.InputJsonValue },
    });
    res.json({ success: true, message: "Data Bongkaran berhasil diperbarui.", data: updated });
  })
);

bongkaranRouter.delete(
  "/:id",
  requireMenuInput("bongkaran"),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.bongkaranLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Bongkaran tidak ditemukan.");
    await prisma.bongkaranLog.delete({ where: { id } });
    res.json({ success: true, message: "Data Bongkaran berhasil dihapus." });
  })
);

const upload = createUploader();

bongkaranRouter.post(
  "/:id/attachments",
  requireWrite,
  requireMenuInput("bongkaran"),
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const logId = Number(req.params.id);
    const log = await prisma.bongkaranLog.findUnique({ where: { id: logId } });
    if (!log) throw new HttpError(404, "Data Bongkaran tidak ditemukan.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.bongkaranAttachment.create({
      data: {
        logId: log.id,
        order: log.order,
        fileName: req.file.originalname,
        filePath: await uploadToBlob("bongkaran", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
