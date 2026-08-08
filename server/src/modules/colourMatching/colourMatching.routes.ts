import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";
import * as stageGate from "../../lib/stageGate";
import { sanitizeNik, sanitizeMembers } from "../../lib/employeeNik";

export const colourMatchingRouter = Router();
colourMatchingRouter.use(requireAuth);
colourMatchingRouter.use(requireMenuView("colourMatching"));

// Transform ke `null` (bukan `undefined`) supaya kalau field ini DIKOSONGKAN
// saat Edit, Prisma benar-benar meng-null-kannya di database -- Prisma
// `update()` menganggap `undefined` sebagai "jangan ubah field ini", jadi
// kalau di-transform ke undefined nilai lama malah tetap nyangkut.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

/** SAMA seperti optionalDate, tapi wajib terisi -- lihat requiredDate di
 * premixAftermix.routes.ts utk alasan lengkapnya (revisi 2026-07-28). */
const requiredDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null))
  .refine((v): v is Date => v !== null, { message: "Form Received wajib diisi." });

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
    typesOfProducts: z.string().trim().min(1, "Types of Products wajib diisi."),
    baseColor: z.string().trim().min(1, "Base Color wajib diisi."),
    formPerMan: z.string().optional(),
    formReceived: requiredDate,
    start: optionalDate,
    finish: optionalDate,
    spvName: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
    spvNik: z.string().trim().optional().nullable(),
    spvColourMatching: z.string().trim().min(1, "Nama SPV Colour Matching wajib diisi."),
    spvColourMatchingNik: z.string().trim().optional().nullable(),
    leaderName: z.string().trim().min(1, "Nama Leader wajib diisi."),
    leaderNik: z.string().trim().optional().nullable(),
    members: z
      .array(z.object({ name: z.string().trim().min(1), nik: z.string().trim().optional().nullable() }))
      .optional(),
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Form Received/IU Plant/Material Number/dst sudah wajib TANPA SYARAT
    // lewat skema di atas (direvisi 2026-07-28, lihat requiredDate). Sisa
    // tahap granular cuma 1: Start terisi -> Member & Form/Man jadi wajib
    // (KECUALI Finish); Finish terisi -> Start jadi wajib.
    const hasStart = data.start != null;
    const hasFinish = data.finish != null;
    const hasMembers = (data.members?.length ?? 0) > 0;
    const hasFormPerMan = Boolean(data.formPerMan && data.formPerMan.trim());

    if (hasStart) {
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
 * "Aftermix - DN" -- DISEDERHANAKAN 2026-07-29 sesuai instruksi eksplisit
 * user (revisi aturan Aftermix), SAMA PERSIS dgn aftermixProcessLabel di
 * dashboard.routes.ts: cuma Finish/Start/Form Received (Leader/Member/Qty per
 * Man TIDAK lagi disyaratkan) -- supaya definisi "Aftermix - DN" konsisten
 * antara kolom "Proses" dashboard & syarat masuk antrian ini (kalau beda,
 * bisa kejadian lagi spt bug List Antrian Approval sebelumnya: dashboard
 * bilang sudah selesai tapi menu antrian tidak menganggap demikian).
 */
function isAftermixDone(r: { formReceived: Date | null; start: Date | null; finish: Date | null }): boolean {
  return Boolean(r.finish && r.start && r.formReceived);
}

/**
 * "PWO Schedule & Queue" -- daftar PWO (Order) yang sudah "Aftermix - DN" dan
 * SEDANG MENUNGGU dikerjakan Colour Matching, DIREVISI TOTAL 2026-07-29
 * sesuai instruksi eksplisit user (dari versi 2026-07-26):
 * 1) Order Aftermix - DN SEKARANG juga wajib Material Number-nya PERNAH py
 *    histori Colour Matching (lintas Order/Batch manapun) -- Material yg
 *    memang tidak pernah lewat Colour Matching (bukan bagian rangkaian
 *    proses material itu) tidak lagi otomatis nyangkut di antrian ini.
 * 2) Order yg SUDAH py baris ColourMatchingLog tapi Start-nya BELUM terisi
 *    (baru Form Received) TETAP di antrian ini -- SEBELUMNYA begitu ADA
 *    baris ColourMatchingLog sama sekali langsung dikeluarkan; sekarang baru
 *    dikeluarkan begitu Start-nya terisi (kerjanya beneran sudah mulai).
 * Order yg sudah masuk tahap manapun SETELAH Colour Matching (Approval,
 * Packing) tetap dikeluarkan dari antrian spt sebelumnya. Diurutkan Finish
 * Aftermix paling awal duluan (FIFO). Pola dasarnya sama dgn
 * /milling/pwo-queue & /premix-aftermix/aftermix-pwo-queue.
 */
colourMatchingRouter.get(
  "/pwo-queue",
  asyncRoute(async (_req, res) => {
    const [aftermixLogs, colourMatchingLogs, approvalOrders, packingOrders] = await Promise.all([
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, orderBy: { timestamp: "desc" } }),
      prisma.colourMatchingLog.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    // Material Number yg PERNAH py histori Colour Matching (lintas Order
    // manapun) -- syarat #1 di atas.
    const colourMatchingMaterialSet = new Set(
      colourMatchingLogs.filter((r): r is typeof r & { materialNumber: string } => r.materialNumber != null).map((r) => r.materialNumber)
    );

    // Dedupe ke baris ColourMatchingLog PALING TERAKHIR per Order, lalu ambil
    // yg Start-nya SUDAH terisi -- syarat #2 di atas (beda dari sebelumnya yg
    // langsung exclude begitu ADA baris apa pun).
    const latestColourMatchingByOrder = new Map<string, (typeof colourMatchingLogs)[number]>();
    for (const r of colourMatchingLogs) {
      if (!latestColourMatchingByOrder.has(r.order)) latestColourMatchingByOrder.set(r.order, r);
    }
    const startedColourMatchingOrderSet = new Set(
      Array.from(latestColourMatchingByOrder.values())
        .filter((r) => r.start != null)
        .map((r) => r.order)
    );

    // Order yg sudah masuk tahap manapun SETELAH Colour Matching -- dianggap
    // sudah "lewat" dari antrian menunggu Colour Matching.
    const pastColourMatchingOrderSet = new Set([...approvalOrders.map((r) => r.order), ...packingOrders.map((r) => r.order)]);

    // Dedupe ke status PALING TERAKHIR per Order (baris pertama yg ditemui,
    // krn aftermixLogs sudah diurutkan timestamp desc) -- konsisten dgn pola
    // "1 baris per Order" yg dipakai di /dashboard/production-orders.
    const latestByOrder = new Map<string, (typeof aftermixLogs)[number]>();
    for (const r of aftermixLogs) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }

    const queueRows = Array.from(latestByOrder.values()).filter(
      (r) =>
        isAftermixDone(r) &&
        r.materialNumber != null &&
        colourMatchingMaterialSet.has(r.materialNumber) &&
        !startedColourMatchingOrderSet.has(r.order) &&
        !pastColourMatchingOrderSet.has(r.order)
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
  requireMenuInput("colourMatching"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    // Material ini benar2 memakai tahap Colour Matching? (2026-08-06,
    // instruksi eksplisit user -- gerbang BARU, terpisah dari gerbang
    // prasyarat di bawah. Lihat komentar checkStageApplicableGate di
    // lib/stageGate.ts.) Baris BARU saja (PUT/Edit tetap bebas).
    const applicable = await stageGate.checkStageApplicableGate("colourMatching", parsed.data.materialNumber);
    if (!applicable.ok) {
      res.status(400).json({ success: false, message: `Material ini tidak memakai proses ${applicable.stageLabel}.` });
      return;
    }
    // Urutan tahap baku (2026-07-31, instruksi eksplisit bos user): Colour
    // Matching baru boleh diinput kalau prasyaratnya (Aftermix, turun ke
    // Milling/Premix kalau di-skip utk Material ini menurut MaterialFlow)
    // sudah "-DN". Baris BARU saja (PUT/Edit tetap bebas).
    const gate = await stageGate.checkColourMatchingGate(parsed.data.order, parsed.data.materialNumber);
    if (!gate.ok) {
      res.status(400).json({
        success: false,
        message: `Order ${parsed.data.order} belum menyelesaikan ${gate.missingStage} (${gate.missingStage} - DN) -- tidak bisa diinput ke Colour Matching dulu.`,
      });
      return;
    }
    const [spvNik, spvColourMatchingNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvNik),
      sanitizeNik(parsed.data.spvColourMatchingNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const created = await prisma.colourMatchingLog.create({
      data: {
        ...parsed.data,
        spvNik,
        spvColourMatchingNik,
        leaderNik,
        members: members as unknown as Prisma.InputJsonValue,
        inputBy: req.auth!.nik,
      },
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
  requireMenuInput("colourMatching"),
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.colourMatchingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Colour Matching tidak ditemukan.");

    const [spvNik, spvColourMatchingNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvNik),
      sanitizeNik(parsed.data.spvColourMatchingNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const updated = await prisma.colourMatchingLog.update({
      where: { id },
      data: {
        ...parsed.data,
        spvNik,
        spvColourMatchingNik,
        leaderNik,
        members: members as unknown as Prisma.InputJsonValue,
      },
    });
    res.json({ success: true, message: "Data Colour Matching berhasil diperbarui.", data: updated });
  })
);

colourMatchingRouter.delete(
  "/:id",
  requireMenuInput("colourMatching"),
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
  requireMenuInput("colourMatching"),
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
