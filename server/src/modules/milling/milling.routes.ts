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
    codeTanki1: z.string().trim().min(1, "Code Tanki 1 (Couple) wajib diisi."),
    // Code Tanki 2 (Moving) TETAP opsional -- auto-terisi dari Code Tanki
    // proses Premix (bukan input manual), pengecualian eksplisit user
    // (2026-07-26), lihat handleOrderFound/checkMachineRecord di MillingPage.tsx.
    codeTanki2: z.string().optional(),
    codeMesin: z.string().trim().min(1, "Code Mesin wajib diisi."),
    formReceived: requiredDate,
    start: optionalDate,
    finish: optionalDate,
    spvProduksi: z.string().trim().min(1, "SPV Produksi wajib diisi."),
    leader: z.string().trim().min(1, "Leader wajib diisi."),
    qtyAct: z.string().optional(),
    members: z.array(z.string()).optional(),
    fineness: readings10,
    visco: readings10,
    suhu: readings10,
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Form Received/Leader/Code Tanki 1/Code Mesin/Material Number/dst sudah
    // wajib TANPA SYARAT lewat skema di atas (direvisi 2026-07-28, lihat
    // requiredDate). Sisa tahap granular cuma 1: Start terisi -> Member, Qty
    // Act, Fineness, Visco, & Suhu jadi wajib (KECUALI Finish); Finish terisi
    // -> Start jadi wajib.
    const hasStart = data.start != null;
    const hasFinish = data.finish != null;
    const hasMembers = (data.members?.length ?? 0) > 0;
    const hasQtyAct = Boolean(data.qtyAct && data.qtyAct.trim());
    const hasReadings = (arr?: string[]) => (arr ?? []).some((v) => v.trim().length > 0);
    const hasFineness = hasReadings(data.fineness);
    const hasVisco = hasReadings(data.visco);
    const hasSuhu = hasReadings(data.suhu);

    if (hasStart) {
      if (!hasMembers) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["members"], message: "Member wajib diisi kalau Start sudah diisi." });
      if (!hasQtyAct) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qtyAct"], message: "Qty Act wajib diisi kalau Start sudah diisi." });
      if (!hasFineness) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fineness"], message: "Fineness wajib diisi kalau Start sudah diisi." });
      if (!hasVisco) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["visco"], message: "Visco wajib diisi kalau Start sudah diisi." });
      if (!hasSuhu) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["suhu"], message: "Suhu wajib diisi kalau Start sudah diisi." });
    }
    if (hasFinish && !hasStart) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finish"], message: "Finish hanya boleh diisi kalau Start sudah diisi." });
    }
  });

/// Data terakhir untuk Order ini di Milling -- dipakai supaya begitu Order
/// yang sama diketik lagi, semua kolom yang sudah pernah diisi langsung muncul.
/// Kalau query `?codeMesin=` diisi, cocokkan Order + Code Mesin SEKALIGUS --
/// dipakai utk kasus 1 Order sedang running di 2 mesin berbeda scr bersamaan
/// (lihat instruksi eksplisit user 2026-07-26), supaya baris utk mesin lain
/// TIDAK ketimpa saat mesin yg berbeda diketik utk Order yg sama.
millingRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const codeMesin = typeof req.query.codeMesin === "string" ? req.query.codeMesin.trim() : "";
    const latest = await prisma.millingLog.findFirst({
      where: codeMesin ? { order, codeMesin } : { order },
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

/**
 * "PWO Schedule & Queue" -- daftar PWO (Order) yang sudah Finish Premix dan
 * SEDANG MENUNGGU dikerjakan Milling (belum ada input Milling sama sekali
 * utk Order itu), sesuai instruksi eksplisit user (2026-07-26). Begitu Order
 * sudah punya input Milling (Start/Finish Milling terisi ATAU baru
 * form-received sekalipun -- pokoknya ada baris di MillingLog), Order itu
 * otomatis hilang dari antrian ini (bukan cuma dari daftar, statusnya sudah
 * "sedang/selesai dikerjakan" jadi bukan lagi antrian).
 *
 * Order yang sudah py input di TAHAP SETELAH Milling (Aftermix, Colour
 * Matching, Approval, Packing) JUGA dikeluarkan dari antrian, walau belum
 * pernah ada input Milling utk Order itu -- sesuai instruksi eksplisit user
 * (2026-07-26): secara alur proses, kalau Order sudah masuk tahap setelah
 * Milling, berarti Premix-nya (dan tahap Milling-nya, entah kenapa tidak
 * tercatat) sudah pasti selesai, jadi Order itu tidak relevan lagi
 * ditampilkan sbg "menunggu Milling". QC SENGAJA tidak diikutkan di sini
 * (bukan bagian dari 4 modul yg disebutkan eksplisit oleh user).
 *
 * Status Premix per Order diambil dari baris PALING TERAKHIR (timestamp Save
 * terbaru) di section PREMIX -- konsisten dgn "status terkini" di
 * /dashboard/production-orders, BUKAN baris pertama yg pernah py Finish.
 * Diurutkan Finish Premix PALING AWAL duluan (FIFO -- yg paling lama
 * menunggu dikerjakan Milling ditampilkan paling atas), sesuai instruksi
 * eksplisit user.
 */
millingRouter.get(
  "/pwo-queue",
  asyncRoute(async (_req, res) => {
    const [premixLogs, millingOrders, aftermixOrders, colourMatchingOrders, approvalOrders, packingOrders] = await Promise.all([
      prisma.premixAftermixLog.findMany({
        where: { section: "PREMIX" },
        orderBy: { timestamp: "desc" },
      }),
      prisma.millingLog.findMany({ select: { order: true } }),
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, select: { order: true } }),
      prisma.colourMatchingLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    const millingOrderSet = new Set(millingOrders.map((r) => r.order));
    // Order yg sudah masuk tahap manapun setelah Milling -- dianggap sudah
    // "lewat" Milling, jadi ikut dikeluarkan dari antrian sama seperti
    // millingOrderSet di atas.
    const pastMillingOrderSet = new Set([
      ...aftermixOrders.map((r) => r.order),
      ...colourMatchingOrders.map((r) => r.order),
      ...approvalOrders.map((r) => r.order),
      ...packingOrders.map((r) => r.order),
    ]);

    // Dedupe ke status PALING TERAKHIR per Order (baris pertama yg ditemui,
    // krn premixLogs sudah diurutkan timestamp desc).
    const latestByOrder = new Map<string, (typeof premixLogs)[number]>();
    for (const r of premixLogs) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }

    const queueRows = Array.from(latestByOrder.values()).filter(
      (r) => r.finish != null && !millingOrderSet.has(r.order) && !pastMillingOrderSet.has(r.order)
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
