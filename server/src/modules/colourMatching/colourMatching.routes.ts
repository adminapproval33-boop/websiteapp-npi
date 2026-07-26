import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

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
    formReceived: optionalDate,
    start: optionalDate,
    finish: optionalDate,
    spvName: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
    leaderName: z.string().trim().min(1, "Nama Leader wajib diisi."),
    members: z.array(z.string()).optional(),
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // 3 tahap granular (Form Received -> Start -> Finish), sesuai instruksi
    // eksplisit user (2026-07-26) -- pola sama persis dgn superRefine di
    // premixAftermix.routes.ts/milling.routes.ts. Form Received DULU selalu
    // wajib (skema lama); sekarang jadi tahap pertama yg opsional, dgn IU
    // Plant sbg syarat pendukungnya (kolom lain spt Types of Products/Base
    // Color/SPV/Leader/Code Tanki sudah wajib dari Zod di atas, tidak
    // tergantung tahap):
    // 1) Form Received terisi -> IU Plant jadi wajib.
    // 2) Start terisi -> Form Received, IU Plant, Member, & Form/Man jadi
    //    wajib (semua KECUALI Finish).
    // 3) Finish terisi -> Start (dan lewat itu, semua syarat tahap 2) jadi
    //    wajib -- gak logis selesai sebelum mulai.
    const hasFormReceived = data.formReceived != null;
    const hasStart = data.start != null;
    const hasFinish = data.finish != null;
    const hasIuPlant = Boolean(data.iuPlant && data.iuPlant.trim());
    const hasMembers = (data.members?.length ?? 0) > 0;
    const hasFormPerMan = Boolean(data.formPerMan && data.formPerMan.trim());

    if (hasFormReceived && !hasIuPlant) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["iuPlant"], message: "IU Plant wajib diisi kalau Form Received sudah diisi." });
    }
    if (hasStart) {
      if (!hasFormReceived) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["formReceived"], message: "Form Received wajib diisi kalau Start sudah diisi." });
      if (!hasIuPlant) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["iuPlant"], message: "IU Plant wajib diisi kalau Start sudah diisi." });
      if (!hasMembers) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["members"], message: "Member wajib diisi kalau Start sudah diisi." });
      if (!hasFormPerMan) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["formPerMan"], message: "Form/Man wajib diisi kalau Start sudah diisi." });
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

/**
 * "Aftermix - DN" -- syarat lengkap tahap terakhir Aftermix (Finish, Start,
 * Form Received, Leader, Member, Qty/Man semua terisi) -- SAMA PERSIS dgn
 * premixOrAftermixProcessLabel di dashboard.routes.ts, tapi cuma butuh
 * boolean "sudah selesai atau belum" (bukan label lengkap 3 tahap) utk
 * keperluan queue di bawah.
 */
function isAftermixDone(r: {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
  leader: string | null;
  qtyPerMan: string | null;
  members: unknown;
}): boolean {
  const hasLeader = Boolean(r.leader && r.leader.trim());
  const hasMembers = Array.isArray(r.members) && r.members.length > 0;
  const hasQtyPerMan = Boolean(r.qtyPerMan && r.qtyPerMan.trim());
  return Boolean(r.finish && r.start && r.formReceived && hasLeader && hasMembers && hasQtyPerMan);
}

/**
 * "PWO Schedule & Queue" -- daftar PWO (Order) yang sudah "Aftermix - DN" dan
 * SEDANG MENUNGGU dikerjakan Colour Matching (belum ada input Colour Matching
 * utk Order itu), sesuai instruksi eksplisit user (2026-07-26) -- pola sama
 * persis dgn /milling/pwo-queue & /premix-aftermix/aftermix-pwo-queue. Order
 * yang sudah masuk Colour Matching sendiri ATAU tahap manapun setelahnya
 * (Approval, Packing) JUGA dikeluarkan dari antrian. Diurutkan Finish
 * Aftermix paling awal duluan (FIFO).
 */
colourMatchingRouter.get(
  "/pwo-queue",
  asyncRoute(async (_req, res) => {
    const [aftermixLogs, colourMatchingOrders, approvalOrders, packingOrders] = await Promise.all([
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, orderBy: { timestamp: "desc" } }),
      prisma.colourMatchingLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    // Order yg sudah masuk Colour Matching sendiri ATAU tahap manapun
    // setelahnya -- dianggap sudah "lewat" dari antrian menunggu Colour Matching.
    const pastColourMatchingOrderSet = new Set([
      ...colourMatchingOrders.map((r) => r.order),
      ...approvalOrders.map((r) => r.order),
      ...packingOrders.map((r) => r.order),
    ]);

    // Dedupe ke status PALING TERAKHIR per Order (baris pertama yg ditemui,
    // krn aftermixLogs sudah diurutkan timestamp desc) -- konsisten dgn pola
    // "1 baris per Order" yg dipakai di /dashboard/production-orders.
    const latestByOrder = new Map<string, (typeof aftermixLogs)[number]>();
    for (const r of aftermixLogs) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }

    const queueRows = Array.from(latestByOrder.values()).filter(
      (r) => isAftermixDone(r) && !pastColourMatchingOrderSet.has(r.order)
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
        iuPlant: r.iuPlant,
        codeTanki: r.codeTanki,
        spvProduksi: r.spvProduksi,
        leader: r.leader,
        members: r.members,
        qtyPerMan: r.qtyPerMan,
        formReceived: r.formReceived,
        start: r.start,
        finish: r.finish,
        remark: r.remark,
      };
    });

    res.json({ success: true, data });
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
        filePath: await uploadToBlob("colour-matching", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
