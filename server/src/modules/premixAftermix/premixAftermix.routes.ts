import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

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

const saveSchema = z
  .object({
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
    start: optionalDate,
    leader: z.string().optional(),
    finish: optionalDate,
    codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
    formReceived: optionalDate,
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // PREMIX & AFTERMIX -- SAMA PERSIS, 3 tahap granular (Form Received ->
    // Start -> Finish), tiap tahap mewajibkan kolom tahap sebelumnya + kolom
    // pendukungnya sendiri sudah terisi. Awalnya AFTERMIX pakai aturan lama
    // (Start & Finish selalu wajib), tapi direvisi 2026-07-26 sesuai instruksi
    // eksplisit user supaya AFTERMIX ikut dapat tahapan granular yg SAMA
    // PERSIS dgn PREMIX (field & aturannya memang identik di 1 model ini,
    // jadi tidak perlu dibedakan per section lagi):
    // 1) Form Received terisi -> Leader jadi wajib (kolom lain di luar
    //    Start/Finish/Member/Qty-Man sudah wajib dari Zod di atas).
    // 2) Start terisi -> Form Received, Leader, Member, & Qty/Man (Liter)
    //    jadi wajib (semua KECUALI Finish).
    // 3) Finish terisi -> Start (dan lewat itu, semua syarat tahap 2) jadi
    //    wajib -- gak logis selesai sebelum mulai.
    const hasFormReceived = data.formReceived != null;
    const hasStart = data.start != null;
    const hasFinish = data.finish != null;
    const hasLeader = Boolean(data.leader && data.leader.trim());
    const hasMembers = (data.members?.length ?? 0) > 0;
    const hasQtyPerMan = Boolean(data.qtyPerMan && data.qtyPerMan.trim());

    if (hasFormReceived && !hasLeader) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leader"], message: "Leader wajib diisi kalau Form Received sudah diisi." });
    }
    if (hasStart) {
      if (!hasFormReceived) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["formReceived"], message: "Form Received wajib diisi kalau Start sudah diisi." });
      if (!hasLeader) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leader"], message: "Leader wajib diisi kalau Start sudah diisi." });
      if (!hasMembers) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["members"], message: "Member wajib diisi kalau Start sudah diisi." });
      if (!hasQtyPerMan) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qtyPerMan"], message: "Qty/Man (Liter) wajib diisi kalau Start sudah diisi." });
    }
    if (hasFinish && !hasStart) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finish"], message: "Finish hanya boleh diisi kalau Start sudah diisi." });
    }
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

/**
 * "Milling - DN" -- syarat lengkap tahap terakhir Milling (Finish, Start,
 * Form Received, Leader, Code Tanki 1, Code Mesin, Member, Qty Act, Fineness,
 * Visco, Suhu semua terisi) -- SAMA PERSIS dgn millingProcessLabel di
 * dashboard.routes.ts, tapi cuma butuh boolean "sudah selesai atau belum"
 * (bukan label lengkap 3 tahap) utk keperluan queue di bawah.
 */
function isMillingDone(r: {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
  leader: string | null;
  codeTanki1: string | null;
  codeMesin: string | null;
  members: unknown;
  qtyAct: string | null;
  fineness: unknown;
  visco: unknown;
  suhu: unknown;
}): boolean {
  const hasLeader = Boolean(r.leader && r.leader.trim());
  const hasCodeTanki1 = Boolean(r.codeTanki1 && r.codeTanki1.trim());
  const hasCodeMesin = Boolean(r.codeMesin && r.codeMesin.trim());
  const hasMembers = Array.isArray(r.members) && r.members.length > 0;
  const hasQtyAct = Boolean(r.qtyAct && r.qtyAct.trim());
  const hasReadings = (v: unknown) => Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim().length > 0);
  return Boolean(
    r.finish &&
      r.start &&
      r.formReceived &&
      hasLeader &&
      hasCodeTanki1 &&
      hasCodeMesin &&
      hasMembers &&
      hasQtyAct &&
      hasReadings(r.fineness) &&
      hasReadings(r.visco) &&
      hasReadings(r.suhu)
  );
}

/**
 * "PWO Schedule & Queue" khusus AFTERMIX -- daftar PWO (Order) yang sudah
 * "Milling - DN" dan SEDANG MENUNGGU dikerjakan Aftermix (belum ada input
 * Aftermix utk Order itu), sesuai instruksi eksplisit user (2026-07-26) --
 * pola sama persis dgn /milling/pwo-queue (yg sumbernya Premix Finish,
 * antriannya utk Milling). Order yang sudah masuk tahap SETELAH Aftermix
 * (Colour Matching, Approval, Packing) JUGA dikeluarkan dari antrian, sama
 * alasannya dgn queue Milling: secara alur proses berarti Aftermix-nya sudah
 * pasti selesai walau entah kenapa tidak tercatat. Diurutkan Finish Milling
 * paling awal duluan (FIFO).
 */
premixAftermixRouter.get(
  "/aftermix-pwo-queue",
  asyncRoute(async (_req, res) => {
    const [millingLogs, aftermixOrders, colourMatchingOrders, approvalOrders, packingOrders] = await Promise.all([
      prisma.millingLog.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, select: { order: true } }),
      prisma.colourMatchingLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    // Order yg sudah masuk Aftermix sendiri ATAU tahap manapun setelahnya --
    // dianggap sudah "lewat" dari antrian menunggu Aftermix.
    const pastAftermixOrderSet = new Set([
      ...aftermixOrders.map((r) => r.order),
      ...colourMatchingOrders.map((r) => r.order),
      ...approvalOrders.map((r) => r.order),
      ...packingOrders.map((r) => r.order),
    ]);

    // Dedupe ke status PALING TERAKHIR per Order (baris pertama yg ditemui,
    // krn millingLogs sudah diurutkan timestamp desc) -- konsisten dgn pola
    // "1 baris per Order" yg dipakai di /dashboard/production-orders.
    const latestByOrder = new Map<string, (typeof millingLogs)[number]>();
    for (const r of millingLogs) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }

    const queueRows = Array.from(latestByOrder.values()).filter(
      (r) => isMillingDone(r) && !pastAftermixOrderSet.has(r.order)
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
        codeTanki1: r.codeTanki1,
        codeTanki2: r.codeTanki2,
        codeMesin: r.codeMesin,
        spvProduksi: r.spvProduksi,
        leader: r.leader,
        members: r.members,
        qtyAct: r.qtyAct,
        formReceived: r.formReceived,
        start: r.start,
        finish: r.finish,
        remark: r.remark,
      };
    });

    res.json({ success: true, data });
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
        filePath: await uploadToBlob("premix-aftermix", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: attachment });
  })
);
