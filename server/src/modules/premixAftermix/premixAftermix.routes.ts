import { Router, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";
import * as stageGate from "../../lib/stageGate";
import { MENU_LABELS, getMenuLevel } from "../../lib/menuAccess";
import { sanitizeNik, sanitizeMembers } from "../../lib/employeeNik";

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

/** SAMA seperti optionalDate, tapi wajib terisi (bukan boleh dikosongkan) --
 * dipakai utk Form Received, yg direvisi 2026-07-28 sesuai penegasan
 * eksplisit user: "kolom lain KECUALI Start/Finish/Member/Qty-Man wajib
 * terisi" dibaca sbg wajib BASELINE (berlaku di setiap Save), BUKAN cuma
 * trigger tahap begitu Form Received itu sendiri diisi. */
const requiredDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null))
  .refine((v): v is Date => v !== null, { message: "Form Received wajib diisi." });

const saveSchema = z
  .object({
    section: sectionEnum,
    order: z.string().trim().min(1, "Order wajib diisi."),
    materialNumber: z.string().trim().min(1, "Material Number wajib diisi."),
    materialDescription: z.string().trim().min(1, "Material Description wajib diisi."),
    batch: z.string().trim().min(1, "Batch wajib diisi."),
    orderQty: z.string().trim().min(1, "Order Qty wajib diisi."),
    plant: z.string().trim().min(1, "Plant wajib diisi."),
    iuPlant: z.string().trim().min(1, "IU Plant wajib diisi."),
    spvProduksi: z.string().trim().min(1, "Nama SPV Produksi wajib diisi."),
    spvProduksiNik: z.string().trim().optional().nullable(),
    members: z
      .array(z.object({ name: z.string().trim().min(1), nik: z.string().trim().optional().nullable() }))
      .optional(),
    qtyPerMan: z.string().optional(),
    start: optionalDate,
    leader: z.string().trim().min(1, "Leader wajib diisi."),
    leaderNik: z.string().trim().optional().nullable(),
    finish: optionalDate,
    codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
    formReceived: requiredDate,
    remark: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // PREMIX & AFTERMIX -- SAMA PERSIS. Form Received/Leader/Material Number/
    // dst sudah wajib TANPA SYARAT lewat skema di atas (direvisi 2026-07-28,
    // lihat requiredDate). Sisa tahap granular cuma 1: Start terisi -> Member
    // & Qty/Man (Liter) jadi wajib (KECUALI Finish); Finish terisi -> Start
    // jadi wajib -- gak logis selesai sebelum mulai.
    const hasStart = data.start != null;
    const hasFinish = data.finish != null;
    const hasMembers = (data.members?.length ?? 0) > 0;
    const hasQtyPerMan = Boolean(data.qtyPerMan && data.qtyPerMan.trim());

    if (hasStart) {
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
  asyncRoute(async (req: AuthedRequest, res) => {
    const order = String(req.params.order).trim();
    const section = sectionEnum.safeParse(req.query.section);
    if (section.success && !checkSectionMenuView(req, res, section.data)) return;
    const latest = await prisma.premixAftermixLog.findFirst({
      where: { order, ...(section.success ? { section: section.data } : {}) },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

/**
 * "PWO Schedule & Queue" khusus PREMIX -- BEDA dari antrian Milling/Aftermix/
 * Colour Matching (sumbernya History tahap SEBELUMNYA), Premix adalah tahap
 * PERTAMA jadi tidak py tahap sebelumnya -- sumbernya langsung Master Data
 * Cooispi (Referensi Order/PO SAP-COOISPI), sesuai instruksi eksplisit user
 * (2026-07-29, ditegaskan ulang 2026-07-30). Order masuk antrian ini kalau:
 * 1) Ada di Master Data Cooispi, DAN
 * 2) Material Number-nya PERNAH py histori Premix (lintas Order manapun) --
 *    kalau Material Number itu memang tidak pernah lewat Premix, dianggap
 *    produk itu prosesnya TANPA Premix (bukan bug, bukan "ketinggalan"),
 *    jadi TIDAK masuk antrian, DAN
 * 3) Start-nya BELUM terisi (bukan "belum py baris Premix sama sekali") --
 *    Order yg SUDAH py baris PremixLog tapi baru Form Received (Start belum
 *    diisi) TETAP di antrian ini, DIPERBAIKI 2026-07-30 sesuai instruksi
 *    eksplisit user supaya konsisten dgn pola Milling/Aftermix/Colour
 *    Matching (sebelumnya salah exclude begitu ADA baris Premix apa pun), DAN
 * 4) BELUM masuk tahap manapun setelah Premix (Milling, Aftermix, Colour
 *    Matching, Approval, Packing) -- kalau sudah, berarti Premix-nya sudah
 *    pasti "terlewati" entah kenapa tidak tercatat, jadi tidak relevan lagi
 *    ditampilkan sbg "menunggu Premix".
 * MasterOrder TIDAK py kolom timestamp "kapan Order ini pertama muncul" yg
 * bisa diandalkan (updatedAt ikut ke-refresh tiap kali file di-upload ulang,
 * termasuk utk Order lama) -- diurutkan `id` ASC (urutan insert) sbg proxy
 * FIFO, bukan tanggal.
 */
premixAftermixRouter.get(
  "/premix-pwo-queue",
  requireMenuView("premix"),
  asyncRoute(async (_req, res) => {
    const [masterOrders, premixLogs, millingOrders, aftermixOrders, colourMatchingOrders, approvalOrders, packingOrders] = await Promise.all([
      prisma.masterOrder.findMany({
        select: { id: true, order: true, materialNumber: true, materialDescription: true, batch: true, orderQty: true, plant: true },
        orderBy: { id: "asc" },
      }),
      prisma.premixAftermixLog.findMany({ where: { section: "PREMIX" }, orderBy: { timestamp: "desc" } }),
      prisma.millingLog.findMany({ select: { order: true } }),
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, select: { order: true } }),
      prisma.colourMatchingLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    const premixMaterialSet = new Set(
      premixLogs.filter((r): r is typeof r & { materialNumber: string } => r.materialNumber != null).map((r) => r.materialNumber)
    );

    // Dedupe ke baris Premix PALING TERAKHIR per Order, lalu ambil yg
    // Start-nya SUDAH terisi -- syarat #3 di atas (beda dari sebelumnya yg
    // langsung exclude begitu ADA baris apa pun). Baris Form-Received-only
    // (belum ada di set ini) tetap dipakai jg utk menyuguhkan formReceived-nya
    // sendiri di kolom queue, bukan cuma referensi Master Data polos.
    const latestPremixByOrder = new Map<string, (typeof premixLogs)[number]>();
    for (const r of premixLogs) {
      if (!latestPremixByOrder.has(r.order)) latestPremixByOrder.set(r.order, r);
    }
    const startedPremixOrderSet = new Set(
      Array.from(latestPremixByOrder.values())
        .filter((r) => r.start != null)
        .map((r) => r.order)
    );

    const pastPremixOrderSet = new Set([
      ...millingOrders.map((r) => r.order),
      ...aftermixOrders.map((r) => r.order),
      ...colourMatchingOrders.map((r) => r.order),
      ...approvalOrders.map((r) => r.order),
      ...packingOrders.map((r) => r.order),
    ]);

    const data = masterOrders
      .filter(
        (r) =>
          r.materialNumber != null &&
          premixMaterialSet.has(r.materialNumber) &&
          !startedPremixOrderSet.has(r.order) &&
          !pastPremixOrderSet.has(r.order)
      )
      .map((r) => ({
        order: r.order,
        materialNumber: r.materialNumber,
        materialDescription: r.materialDescription,
        batch: r.batch,
        orderQty: r.orderQty,
        plant: r.plant,
        // Kalau sudah ada baris Premix Form-Received-only utk Order ini,
        // tampilkan tanggalnya -- lebih informatif drpd cuma referensi
        // Master Data polos.
        formReceived: latestPremixByOrder.get(r.order)?.formReceived ?? null,
      }));

    res.json({ success: true, data });
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
 * "Milling - DN" dan SEDANG MENUNGGU dikerjakan Aftermix, DIREVISI TOTAL
 * 2026-07-29 sesuai instruksi eksplisit user (dari versi 2026-07-26), pola
 * SAMA PERSIS dgn revisi /colour-matching/pwo-queue:
 * 1) Order Milling - DN SEKARANG juga wajib Material Number-nya PERNAH py
 *    histori Aftermix (lintas Order/Batch manapun) -- Material yg memang
 *    tidak pernah lewat Aftermix tidak lagi otomatis nyangkut di antrian ini.
 * 2) Order yg SUDAH py baris Aftermix (premixAftermixLog section AFTERMIX)
 *    tapi Start-nya BELUM terisi (baru Form Received) TETAP di antrian ini --
 *    SEBELUMNYA begitu ADA baris Aftermix sama sekali langsung dikeluarkan;
 *    sekarang baru dikeluarkan begitu Start-nya terisi.
 * Order yg sudah masuk tahap SETELAH Aftermix (Colour Matching, Approval,
 * Packing) tetap dikeluarkan dari antrian spt sebelumnya. Diurutkan Finish
 * Milling paling awal duluan (FIFO).
 */
premixAftermixRouter.get(
  "/aftermix-pwo-queue",
  requireMenuView("aftermix"),
  asyncRoute(async (_req, res) => {
    const [millingLogs, aftermixLogs, colourMatchingOrders, approvalOrders, packingOrders] = await Promise.all([
      prisma.millingLog.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.premixAftermixLog.findMany({ where: { section: "AFTERMIX" }, orderBy: { timestamp: "desc" } }),
      prisma.colourMatchingLog.findMany({ select: { order: true } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
      prisma.packingLog.findMany({ select: { order: true } }),
    ]);

    // Material Number yg PERNAH py histori Aftermix (lintas Order manapun) --
    // syarat #1 di atas.
    const aftermixMaterialSet = new Set(
      aftermixLogs.filter((r): r is typeof r & { materialNumber: string } => r.materialNumber != null).map((r) => r.materialNumber)
    );

    // Dedupe ke baris Aftermix PALING TERAKHIR per Order, lalu ambil yg
    // Start-nya SUDAH terisi -- syarat #2 di atas (beda dari sebelumnya yg
    // langsung exclude begitu ADA baris apa pun).
    const latestAftermixByOrder = new Map<string, (typeof aftermixLogs)[number]>();
    for (const r of aftermixLogs) {
      if (!latestAftermixByOrder.has(r.order)) latestAftermixByOrder.set(r.order, r);
    }
    const startedAftermixOrderSet = new Set(
      Array.from(latestAftermixByOrder.values())
        .filter((r) => r.start != null)
        .map((r) => r.order)
    );

    // Order yg sudah masuk tahap manapun SETELAH Aftermix -- dianggap sudah
    // "lewat" dari antrian menunggu Aftermix.
    const pastAftermixOrderSet = new Set([
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
      (r) =>
        isMillingDone(r) &&
        r.materialNumber != null &&
        aftermixMaterialSet.has(r.materialNumber) &&
        !startedAftermixOrderSet.has(r.order) &&
        !pastAftermixOrderSet.has(r.order)
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
  asyncRoute(async (req: AuthedRequest, res) => {
    const section = sectionEnum.safeParse(req.query.section);
    if (section.success && !checkSectionMenuView(req, res, section.data)) return;
    const rows = await prisma.premixAftermixLog.findMany({
      where: section.success ? { section: section.data } : undefined,
      orderBy: { timestamp: "desc" },
      include: { attachments: true },
      take: 500,
    });
    res.json({ success: true, data: rows });
  })
);

/** Section ("PREMIX"/"AFTERMIX") -> key View/Input/Hide (2026-08-03,
 * instruksi eksplisit user) -- router ini dipakai BERSAMA utk 2 menu
 * berbeda, jadi key-nya tergantung `section` di body/query, bukan statis spt
 * modul lain (tidak bisa pakai requireMenuView/requireMenuInput sbg
 * middleware biasa KECUALI di route yg section-nya sudah pasti dari path,
 * lihat /premix-pwo-queue & /aftermix-pwo-queue di atas). */
function sectionMenuKey(section: "PREMIX" | "AFTERMIX") {
  return section === "PREMIX" ? ("premix" as const) : ("aftermix" as const);
}

/** Gerbang GET (History/latest-by-order) -- blokir HANYA kalau level-nya "HIDE". */
function checkSectionMenuView(req: AuthedRequest, res: Response, section: "PREMIX" | "AFTERMIX"): boolean {
  const menuKey = sectionMenuKey(section);
  if (getMenuLevel(req.auth!, menuKey) === "HIDE") {
    res.status(403).json({ success: false, message: `Akses ditolak. Akun Anda tidak memiliki akses ke menu ${MENU_LABELS[menuKey]}.` });
    return false;
  }
  return true;
}

/** Gerbang POST/PUT/attachments -- blokir kalau level-nya "VIEW" ATAU "HIDE". */
function checkSectionMenuInput(req: AuthedRequest, res: Response, section: "PREMIX" | "AFTERMIX"): boolean {
  const menuKey = sectionMenuKey(section);
  if (getMenuLevel(req.auth!, menuKey) !== "INPUT") {
    res.status(403).json({
      success: false,
      message: `Akses ditolak. Akun Anda dibatasi utk menu ${MENU_LABELS[menuKey]} (cuma bisa lihat, tidak bisa input).`,
    });
    return false;
  }
  return true;
}

premixAftermixRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (!checkSectionMenuInput(req, res, parsed.data.section)) return;
    // Material ini benar2 memakai tahap ini? (2026-08-06, instruksi eksplisit
    // user -- gerbang BARU, terpisah dari gerbang prasyarat di bawah. Lihat
    // komentar checkStageApplicableGate di lib/stageGate.ts.) Baris BARU saja
    // (PUT/Edit tetap bebas).
    const stageKey = parsed.data.section === "PREMIX" ? "premix" : "aftermix";
    const applicable = await stageGate.checkStageApplicableGate(stageKey, parsed.data.materialNumber);
    if (!applicable.ok) {
      res.status(400).json({ success: false, message: `Material ini tidak memakai proses ${applicable.stageLabel}.` });
      return;
    }
    // Urutan tahap baku (2026-07-31, instruksi eksplisit bos user): Aftermix
    // baru boleh diinput kalau prasyaratnya (Milling, atau Premix kalau
    // Milling di-skip utk Material ini menurut MaterialFlow) sudah "-DN".
    // Premix (tahap pertama, section berbeda) TIDAK dicek apa-apa. Baris
    // BARU saja (PUT/Edit tetap bebas).
    if (parsed.data.section === "AFTERMIX") {
      const gate = await stageGate.checkAftermixGate(parsed.data.order, parsed.data.materialNumber);
      if (!gate.ok) {
        res.status(400).json({
          success: false,
          message: `Order ${parsed.data.order} belum menyelesaikan ${gate.missingStage} (${gate.missingStage} - DN) -- tidak bisa diinput ke Aftermix dulu.`,
        });
        return;
      }
    }
    const [spvProduksiNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvProduksiNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const created = await prisma.premixAftermixLog.create({
      data: {
        ...parsed.data,
        spvProduksiNik,
        leaderNik,
        members: members as unknown as Prisma.InputJsonValue,
        inputBy: req.auth!.nik,
      },
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
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (!checkSectionMenuInput(req, res, parsed.data.section)) return;
    const id = Number(req.params.id);
    const existing = await prisma.premixAftermixLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");

    const [spvProduksiNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvProduksiNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const updated = await prisma.premixAftermixLog.update({
      where: { id },
      data: { ...parsed.data, spvProduksiNik, leaderNik, members: members as unknown as Prisma.InputJsonValue },
    });
    res.json({ success: true, message: "Data berhasil diperbarui.", data: updated });
  })
);

premixAftermixRouter.delete(
  "/:id",
  asyncRoute(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.premixAftermixLog.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    if (!checkSectionMenuInput(req, res, existing.section)) return;
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
    if (!checkSectionMenuInput(req, res, log.section)) return;
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

// ===================== PWO Schedule (kalender mingguan) =====================
// 2026-08-04, instruksi eksplisit user: tab "PWO Schedule & Queue" bisa
// menjadwalkan Order antrian ke kalender mingguan. VERSI AWAL klik -> pilih
// tanggal/jam; 2026-08-05 DISEDERHANAKAN (instruksi eksplisit user: "menu jam
// tidak perlu, cukup list & nomor urutan") jadi drag-drop Queue -> hari
// (scheduledDate, tanpa jam) + urutan prioritas dalam hari itu (sequence).
// Murni metadata jadwal (model PwoSchedule), terpisah dari
// PremixAftermixLog -- lihat komentar di schema.prisma.

const scheduleSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  section: sectionEnum,
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  scheduledDate: z.coerce.date(),
});

premixAftermixRouter.get(
  "/pwo-schedule",
  asyncRoute(async (req: AuthedRequest, res) => {
    const section = req.query.section === "AFTERMIX" ? "AFTERMIX" : "PREMIX";
    if (!checkSectionMenuView(req, res, section)) return;
    const rows = await prisma.pwoSchedule.findMany({
      where: { section },
      orderBy: [{ scheduledDate: "asc" }, { sequence: "asc" }],
    });

    // "Today-ATP" (2026-08-05, instruksi eksplisit user) -- live lookup ke
    // Master Data Referensi Order/PO (SAP-COOISPI), BUKAN disimpan di
    // PwoSchedule sendiri, supaya re-upload Master Data otomatis update
    // nilainya di sini juga tanpa langkah tambahan (pola yg sama spt %GR
    // dkk di dashboard.routes.ts -- lihat komentar UPDATE 2026-08-01 di
    // project_cooispi_master_data_workflow).
    const orders = Array.from(new Set(rows.map((r) => r.order)));
    const masterOrders = await prisma.masterOrder.findMany({
      where: { order: { in: orders } },
      select: { order: true, todayAtp: true },
    });
    const todayAtpByOrder = new Map(masterOrders.map((m) => [m.order, m.todayAtp]));

    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, todayAtp: todayAtpByOrder.get(r.order) ?? null })),
    });
  })
);

/// Drag Order dari strip Queue -> hari di Kalender (baru ATAU pindah hari,
/// 2026-08-05) -- upsert by order+section (jadwal ulang Order yg sama
/// menimpa jadwal lamanya, bukan bikin duplikat). `sequence` SELALU
/// di-append otomatis ke urutan PALING BAWAH hari target (max sequence hari
/// itu + 1) -- klien tidak pernah kirim sequence eksplisit di sini, itu cuma
/// utk reorder DALAM 1 hari yg sama (lihat PUT /pwo-schedule/reorder di bawah).
premixAftermixRouter.post(
  "/pwo-schedule",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (!checkSectionMenuInput(req, res, parsed.data.section)) return;
    const { order, section, scheduledDate, ...rest } = parsed.data;
    const maxSeq = await prisma.pwoSchedule.aggregate({
      where: { section, scheduledDate },
      _max: { sequence: true },
    });
    const sequence = (maxSeq._max.sequence ?? -1) + 1;
    const saved = await prisma.pwoSchedule.upsert({
      where: { order_section: { order, section } },
      create: { order, section, scheduledDate, sequence, ...rest, createdBy: req.auth!.nik },
      update: { scheduledDate, sequence, ...rest },
    });
    res.json({ success: true, message: "Jadwal berhasil disimpan.", data: saved });
  })
);

const reorderSchema = z.object({
  section: sectionEnum,
  scheduledDate: z.coerce.date(),
  orderedIds: z.array(z.string()).min(1),
});

/// Reorder drag-drop DALAM 1 hari yg sama (2026-08-05, instruksi eksplisit
/// user: nomor urutan bisa diatur bebas) -- klien kirim urutan ID final utk
/// 1 hari sekaligus (hasil drag-reorder di layar), server set
/// sequence=index utk tiap ID via transaksi (bukan API sempit per-item,
/// supaya semua nomor urutan hari itu selalu konsisten 0..n-1 tanpa celah).
premixAftermixRouter.put(
  "/pwo-schedule/reorder",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (!checkSectionMenuInput(req, res, parsed.data.section)) return;
    const { section, scheduledDate, orderedIds } = parsed.data;
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.pwoSchedule.updateMany({ where: { id, section, scheduledDate }, data: { sequence: index } })
      )
    );
    res.json({ success: true, message: "Urutan berhasil disimpan." });
  })
);

premixAftermixRouter.delete(
  "/pwo-schedule/:id",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const existing = await prisma.pwoSchedule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Jadwal tidak ditemukan.");
    if (!checkSectionMenuInput(req, res, existing.section)) return;
    await prisma.pwoSchedule.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Jadwal berhasil dihapus." });
  })
);
