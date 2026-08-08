import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";
import * as stageGate from "../../lib/stageGate";
import { sanitizeNik, sanitizeMembers } from "../../lib/employeeNik";
import { isValidTankCode } from "../../lib/tankCode";

export const millingRouter = Router();
millingRouter.use(requireAuth);
millingRouter.use(requireMenuView("milling"));

/// Bacaan Fineness/Visco/Suhu per Pass, jumlah Pass TIDAK dibatasi (2026-08-05,
/// instruksi eksplisit user -- sebelumnya dibatasi max 10, dilepas krn ada
/// kasus nyata sampai 15 Pass, dan tidak ada alasan bisnis utk batas atas).
const readings10 = z.array(z.string()).optional();

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
    spvProduksiNik: z.string().trim().optional().nullable(),
    leader: z.string().trim().min(1, "Leader wajib diisi."),
    leaderNik: z.string().trim().optional().nullable(),
    qtyAct: z.string().optional(),
    members: z
      .array(z.object({ name: z.string().trim().min(1), nik: z.string().trim().optional().nullable() }))
      .optional(),
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

/** Milling py DUA kolom Code Tanki (Couple/Moving) -- validasi keduanya
 * sekaligus thd Master Data Tanki, kembalikan pesan error pertama yg gagal
 * (atau null kalau semua valid/kosong). */
async function validateTankFields(data: { codeTanki1: string; codeTanki2?: string | null }): Promise<string | null> {
  if (data.codeTanki1 && !(await isValidTankCode(data.codeTanki1))) {
    return "Code Tanki 1 (Couple) tidak ditemukan di Master Data Tanki. Pilih dari daftar.";
  }
  if (data.codeTanki2 && !(await isValidTankCode(data.codeTanki2))) {
    return "Code Tanki 2 (Moving) tidak ditemukan di Master Data Tanki. Pilih dari daftar.";
  }
  return null;
}

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
 * "Premix - DN" -- DISEDERHANAKAN LAGI 2026-07-30 sesuai instruksi eksplisit
 * user (Premix sekarang ikut disederhanakan spt Aftermix/Milling/dst),
 * SAMA PERSIS dgn premixProcessLabel di dashboard.routes.ts: cuma Finish/
 * Start/Form Received (Leader/Member/Qty per Man TIDAK lagi disyaratkan) --
 * supaya definisi "Premix - DN" konsisten antara kolom "Proses" dashboard &
 * syarat masuk antrian ini.
 */
function isPremixDone(r: { formReceived: Date | null; start: Date | null; finish: Date | null }): boolean {
  return Boolean(r.finish && r.start && r.formReceived);
}

/**
 * "PWO Schedule & Queue" -- daftar PWO (Order) yang sudah "Premix - DN" dan
 * SEDANG MENUNGGU dikerjakan Milling, DIREVISI 2026-07-29 sesuai instruksi
 * eksplisit user (dari versi 2026-07-26), pola sama dgn revisi
 * /colour-matching/pwo-queue & /premix-aftermix/aftermix-pwo-queue -- BEDA-nya
 * di sini TIDAK ada syarat histori Material Number (tidak diminta utk
 * Milling):
 * 1) Syarat "Premix Done" sekarang literal "Premix - DN" (lihat isPremixDone
 *    di atas) -- sebelumnya cuma cek `finish != null` polos.
 * 2) Order yg SUDAH py baris MillingLog tapi Start-nya BELUM terisi (baru
 *    Form Received) TETAP di antrian ini -- SEBELUMNYA begitu ADA baris
 *    Milling sama sekali langsung dikeluarkan; sekarang baru dikeluarkan
 *    begitu Start-nya terisi.
 * Order yang sudah py input di TAHAP SETELAH Milling (Aftermix, Colour
 * Matching, Approval, Packing) tetap dikeluarkan dari antrian spt
 * sebelumnya. Diurutkan Finish Premix PALING AWAL duluan (FIFO).
 */
millingRouter.get(
  "/pwo-queue",
  asyncRoute(async (_req, res) => {
    const [premixLogs, millingLogs, aftermixOrders, colourMatchingOrders, approvalOrders, packingOrders] = await Promise.all([
      prisma.premixAftermixLog.findMany({
        where: { section: "PREMIX" },
        orderBy: { timestamp: "desc" },
      }),
      prisma.millingLog.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, select: { order: true } }),
      prisma.colourMatchingLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    // Dedupe ke baris MillingLog PALING TERAKHIR per Order, lalu ambil yg
    // Start-nya SUDAH terisi -- syarat #2 di atas (beda dari sebelumnya yg
    // langsung exclude begitu ADA baris apa pun).
    const latestMillingByOrder = new Map<string, (typeof millingLogs)[number]>();
    for (const r of millingLogs) {
      if (!latestMillingByOrder.has(r.order)) latestMillingByOrder.set(r.order, r);
    }
    const startedMillingOrderSet = new Set(
      Array.from(latestMillingByOrder.values())
        .filter((r) => r.start != null)
        .map((r) => r.order)
    );

    // Order yg sudah masuk tahap manapun setelah Milling -- dianggap sudah
    // "lewat" Milling, jadi ikut dikeluarkan dari antrian.
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
      (r) => isPremixDone(r) && !startedMillingOrderSet.has(r.order) && !pastMillingOrderSet.has(r.order)
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
  requireMenuInput("milling"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const tankError = await validateTankFields(parsed.data);
    if (tankError) {
      res.status(400).json({ success: false, message: tankError });
      return;
    }
    // Material ini benar2 memakai tahap Milling? (2026-08-06, instruksi
    // eksplisit user -- gerbang BARU, terpisah dari gerbang prasyarat di
    // bawah. Lihat komentar checkStageApplicableGate di lib/stageGate.ts.)
    // Baris BARU saja (PUT/Edit tetap bebas).
    const applicable = await stageGate.checkStageApplicableGate("milling", parsed.data.materialNumber);
    if (!applicable.ok) {
      res.status(400).json({ success: false, message: `Material ini tidak memakai proses ${applicable.stageLabel}.` });
      return;
    }
    // Urutan tahap baku (2026-07-31, instruksi eksplisit bos user): Milling
    // baru boleh diinput kalau prasyaratnya (Premix, kalau wajib utk Material
    // ini menurut MaterialFlow) sudah "-DN". Baris BARU saja yg dicek
    // (PUT/Edit row yg sudah ada tetap bebas).
    const gate = await stageGate.checkMillingGate(parsed.data.order, parsed.data.materialNumber);
    if (!gate.ok) {
      res.status(400).json({
        success: false,
        message: `Order ${parsed.data.order} belum menyelesaikan ${gate.missingStage} (${gate.missingStage} - DN) -- tidak bisa diinput ke Milling dulu.`,
      });
      return;
    }
    const [spvProduksiNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvProduksiNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const created = await prisma.millingLog.create({
      data: {
        ...parsed.data,
        spvProduksiNik,
        leaderNik,
        members: members as unknown as Prisma.InputJsonValue,
        inputBy: req.auth!.nik,
      },
    });
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
  requireMenuInput("milling"),
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const tankError = await validateTankFields(parsed.data);
    if (tankError) {
      res.status(400).json({ success: false, message: tankError });
      return;
    }
    const id = Number(req.params.id);
    const existing = await prisma.millingLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data Milling tidak ditemukan.");

    const [spvProduksiNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvProduksiNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const updated = await prisma.millingLog.update({
      where: { id },
      data: { ...parsed.data, spvProduksiNik, leaderNik, members: members as unknown as Prisma.InputJsonValue },
    });
    res.json({ success: true, message: "Data Milling berhasil diperbarui.", data: updated });
  })
);

millingRouter.delete(
  "/:id",
  requireMenuInput("milling"),
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
  requireMenuInput("milling"),
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
