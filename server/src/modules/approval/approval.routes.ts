import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

export const approvalRouter = Router();
approvalRouter.use(requireAuth);

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
    materialNumber: z.string().trim().min(1, "Material Number wajib diisi."),
    materialDescription: z.string().trim().min(1, "Material Description wajib diisi."),
    batch: z.string().trim().min(1, "Batch wajib diisi."),
    orderQty: z.string().trim().min(1, "Order Qty wajib diisi."),
    plant: z.string().trim().min(1, "Plant wajib diisi."),
    iuPlant: z.string().trim().min(1, "IU Plant wajib diisi."),
    codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
    mrpPic: z.string().trim().min(1, "Mrp Pic wajib diisi."),
    salesPic: z.string().trim().min(1, "Sales Pic wajib diisi."),
    prepareProduksi: optionalDate,
    sprayMan: z.string().optional(),
    wetSample: z.string().optional(),
    panel: z.string().optional(),
    lotCoa: optionalDate,
    sendToTech: optionalDate,
    technicalDateReceiving: optionalDate,
    submitToCustomer: optionalDate,
    customer: z.string().optional(),
    custSegmen: z.string().optional(),
    techName: z.string().optional(),
    finishApp: optionalDate,
    remark: z.string().optional(),
  })
  .superRefine(async (data, ctx) => {
    // Order/Material Number/Material Description/Batch/Order Qty/Plant/IU
    // Plant/Code Tanki/Mrp Pic/Sales Pic sudah wajib TANPA SYARAT lewat skema
    // di atas. Admin QC Stage/Lot Passed/QC to App/QC Passed TIDAK ada di
    // modul/tabel ini -- itu di menu & tabel AdminQc terpisah (2026-07-28,
    // sesuai instruksi eksplisit user). Rangkaian Production/
    // Technical Input Column (Prepare Date -> Send To Tech -> Submit Tech ->
    // Submit Cust -> Finish App) TETAP mewajibkan "QC to App" sudah terisi
    // lebih dulu, tapi SEKARANG dicek dgn lookup tabel AdminQc by Order
    // (bukan kolom di record Approval ini sendiri lagi).
    const has = {
      prepareProduksi: data.prepareProduksi != null,
      sprayMan: Boolean(data.sprayMan && data.sprayMan.trim()),
      wetSample: Boolean(data.wetSample && data.wetSample.trim()),
      panel: Boolean(data.panel && data.panel.trim()),
      lotCoa: data.lotCoa != null,
      sendToTech: data.sendToTech != null,
      technicalDateReceiving: data.technicalDateReceiving != null,
      submitToCustomer: data.submitToCustomer != null,
      customer: Boolean(data.customer && data.customer.trim()),
      custSegmen: Boolean(data.custSegmen && data.custSegmen.trim()),
      techName: Boolean(data.techName && data.techName.trim()),
      finishApp: data.finishApp != null,
      qcToApproval: false, // diisi di bawah lewat lookup AdminQc, kalau perlu
    };

    function requireField(cond: boolean, path: keyof typeof has, label: string, trigger: string) {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${label} wajib diisi kalau ${trigger} sudah diisi.` });
    }

    const needsQcCheck = has.prepareProduksi || has.sendToTech || has.technicalDateReceiving || has.submitToCustomer || has.finishApp;
    if (needsQcCheck) {
      const latestAdminQc = await prisma.adminQc.findFirst({
        where: { order: data.order },
        orderBy: { timestamp: "desc" },
      });
      has.qcToApproval = latestAdminQc?.qcToApproval != null;
    }

    const cumulativeTiers: { active: boolean; trigger: string; fields: [keyof typeof has, string][] }[] = [
      { active: has.prepareProduksi, trigger: "Prepare Date", fields: [["qcToApproval", "QC to App (Input Admin QC)"]] },
      {
        active: has.sendToTech,
        trigger: "Send To Tech",
        fields: [
          ["qcToApproval", "QC to App (Input Admin QC)"],
          ["prepareProduksi", "Prepare Date"],
          ["sprayMan", "Spray Man"],
          ["wetSample", "Wet Sample"],
          ["panel", "Panel"],
          ["lotCoa", "Lot COA"],
        ],
      },
      {
        active: has.technicalDateReceiving,
        trigger: "Submit Tech",
        fields: [
          ["qcToApproval", "QC to App (Input Admin QC)"],
          ["prepareProduksi", "Prepare Date"],
          ["sprayMan", "Spray Man"],
          ["wetSample", "Wet Sample"],
          ["panel", "Panel"],
          ["lotCoa", "Lot COA"],
          ["sendToTech", "Send To Tech"],
        ],
      },
      {
        active: has.submitToCustomer,
        trigger: "Submit Cust",
        fields: [
          ["qcToApproval", "QC to App (Input Admin QC)"],
          ["prepareProduksi", "Prepare Date"],
          ["sprayMan", "Spray Man"],
          ["wetSample", "Wet Sample"],
          ["panel", "Panel"],
          ["lotCoa", "Lot COA"],
          ["sendToTech", "Send To Tech"],
          ["technicalDateReceiving", "Submit Tech"],
          ["customer", "Customer"],
          ["custSegmen", "Cust Segmen"],
          ["techName", "Tech Name"],
        ],
      },
      {
        active: has.finishApp,
        trigger: "Finish App",
        fields: [
          ["qcToApproval", "QC to App (Input Admin QC)"],
          ["prepareProduksi", "Prepare Date"],
          ["sprayMan", "Spray Man"],
          ["wetSample", "Wet Sample"],
          ["panel", "Panel"],
          ["lotCoa", "Lot COA"],
          ["sendToTech", "Send To Tech"],
          ["technicalDateReceiving", "Submit Tech"],
          ["submitToCustomer", "Submit Cust"],
          ["customer", "Customer"],
          ["custSegmen", "Cust Segmen"],
          ["techName", "Tech Name"],
        ],
      },
    ];
    for (const tier of cumulativeTiers) {
      if (!tier.active) continue;
      for (const [field, label] of tier.fields) requireField(has[field], field, label, tier.trigger);
    }
  });

type StatusVerdict = "Pending Approval" | "Approval" | "Oke Approval";

function computeStatus(techName: string | null, finishApp: Date | null): StatusVerdict {
  if (finishApp) return "Oke Approval";
  if (techName) return "Approval";
  return "Pending Approval";
}

function formatProcessingTime(start: Date, end: Date | null): string {
  const endTime = end ?? new Date();
  const ms = Math.max(0, endTime.getTime() - start.getTime());
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days} hari ${hours} jam`;
}

// ===================== Autofill dari Order terakhir =====================

approvalRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const latest = await prisma.approvalSchedule.findFirst({
      where: { order: String(req.params.order).trim() },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: latest });
  })
);

// ===================== List Antrian Approval =====================

/** Order yg Admin QC Stage TERBARUnya "Approval" atau "Joint Lot" (lihat
 * modules/adminQc), dan BELUM PERNAH diinput ke ApprovalSchedule -- ini yg
 * dipakai menu "List Antrian Approval" (2026-07-29, sesuai instruksi
 * eksplisit user). Order otomatis hilang dari daftar ini begitu sudah ada
 * input Approval utk Order tersebut -- SENGAJA TIDAK dicek status Packing
 * (direvisi 2026-07-29, instruksi eksplisit user): sempat Order yg sudah
 * py baris PackingLog ikut dikeluarkan dari sini juga, tapi itu bikin
 * administrasi Approval jadi "terlewat" begitu saja kalau tim Packing input
 * lebih dulu drpd tim Approval (padahal urutan real-world tidak selalu
 * berurutan) -- kolom "Proses" & "Production Actions" SENGAJA dibuat
 * independen, supaya tetap ketahuan kalau ada Order yg sudah di-Packing
 * tapi administrasi Approval-nya belum selesai. */
approvalRouter.get(
  "/queue",
  asyncRoute(async (_req, res) => {
    const [adminQcRows, approvalOrders] = await Promise.all([
      prisma.adminQc.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.approvalSchedule.findMany({ select: { order: true } }),
    ]);

    const approvalOrderSet = new Set(approvalOrders.map((r) => r.order));

    // Dedupe ke Admin QC Stage PALING TERAKHIR per Order (baris pertama yg
    // ditemui, krn adminQcRows sudah diurutkan timestamp desc).
    const latestByOrder = new Map<string, (typeof adminQcRows)[number]>();
    for (const r of adminQcRows) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }

    const queueRows = Array.from(latestByOrder.values()).filter(
      (r) => (r.typeLot === "Approval" || r.typeLot === "Joint Lot") && !approvalOrderSet.has(r.order)
    );
    queueRows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

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

// ===================== Product List (item yang belum Finish App) =====================

approvalRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const onlyOpen = req.query.onlyOpen !== "false";
    const { order, materialNumber, materialDescription, batch, finishApp } = req.query as Record<string, string | undefined>;

    const rows = await prisma.approvalSchedule.findMany({
      where: {
        AND: [
          onlyOpen ? { finishApp: null } : {},
          order ? { order: { contains: order, mode: "insensitive" } } : {},
          materialNumber ? { materialNumber: { contains: materialNumber, mode: "insensitive" } } : {},
          materialDescription ? { materialDescription: { contains: materialDescription, mode: "insensitive" } } : {},
          batch ? { batch: { contains: batch, mode: "insensitive" } } : {},
          finishApp === "" ? { finishApp: null } : {},
        ],
      },
      orderBy: { timestamp: "desc" },
      take: 500,
    });

    res.json({ success: true, data: rows });
  })
);

// ===================== Lot History (semua data + status/processing time) =====================

const FILTERABLE_COLUMNS = [
  "order",
  "materialNumber",
  "materialDescription",
  "batch",
  "plant",
  "iuPlant",
  "codeTanki",
  "mrpPic",
  "salesPic",
  "sprayMan",
  "customer",
  "techName",
  "remark",
] as const;

approvalRouter.get(
  "/lot-history",
  asyncRoute(async (req, res) => {
    const filterCol = String(req.query.filterCol ?? "");
    const filterValue = String(req.query.filterValue ?? "").trim();
    const statusFilter = String(req.query.status ?? "");

    const where =
      filterValue && (FILTERABLE_COLUMNS as readonly string[]).includes(filterCol)
        ? { [filterCol]: { contains: filterValue, mode: "insensitive" as const } }
        : {};

    const rows = await prisma.approvalSchedule.findMany({
      where,
      include: { attachments: { select: { id: true } } },
      orderBy: { timestamp: "desc" },
      take: 1000,
    });

    const enriched = rows.map((row) => ({
      ...row,
      status: computeStatus(row.techName, row.finishApp),
      processingTime: formatProcessingTime(row.timestamp, row.finishApp),
      hasAttachment: row.attachments.length > 0,
    }));

    const filtered = statusFilter ? enriched.filter((r) => r.status === statusFilter) : enriched;

    res.json({ success: true, data: filtered });
  })
);

// ===================== CRUD =====================

approvalRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = await saveSchema.safeParseAsync(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.approvalSchedule.create({
      data: { ...parsed.data, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data Approval berhasil disimpan.", data: created });
  })
);

approvalRouter.put(
  "/:approvalId",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const parsed = await saveSchema.safeParseAsync(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const approvalId = req.params.approvalId;
    const existing = await prisma.approvalSchedule.findUnique({ where: { approvalId } });
    if (!existing) throw new HttpError(404, "Data Approval tidak ditemukan.");

    const updated = await prisma.approvalSchedule.update({ where: { approvalId }, data: parsed.data });
    res.json({ success: true, message: "Data Approval berhasil diperbarui.", data: updated });
  })
);

approvalRouter.delete(
  "/:approvalId",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const approvalId = req.params.approvalId;
    const existing = await prisma.approvalSchedule.findUnique({ where: { approvalId } });
    if (!existing) throw new HttpError(404, "Data Approval tidak ditemukan.");
    await prisma.approvalSchedule.delete({ where: { approvalId } });
    res.json({ success: true, message: "Data Approval berhasil dihapus." });
  })
);

// ===================== Attachments =====================

const upload = createUploader();

approvalRouter.get(
  "/:approvalId/attachments",
  asyncRoute(async (req, res) => {
    const attachments = await prisma.approvalAttachment.findMany({
      where: { approvalId: req.params.approvalId },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: attachments });
  })
);

approvalRouter.post(
  "/:approvalId/attachments",
  requireWrite,
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const approvalId = req.params.approvalId;
    const approval = await prisma.approvalSchedule.findUnique({ where: { approvalId } });
    if (!approval) throw new HttpError(404, "Simpan data Approval terlebih dahulu sebelum mengunggah lampiran.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const remarkNote = String(req.body.remark ?? "").trim();

    const [attachment] = await prisma.$transaction([
      prisma.approvalAttachment.create({
        data: {
          approvalId,
          fileName: req.file.originalname,
          filePath: await uploadToBlob("approval", req.file),
          fileType: req.file.mimetype,
          remark: remarkNote || null,
          uploadedBy: req.auth!.nik,
        },
      }),
      ...(remarkNote
        ? [
            prisma.approvalSchedule.update({
              where: { approvalId },
              data: {
                remark: `${approval.remark ? approval.remark + " | " : ""}[${new Date().toISOString()}] ${remarkNote}`,
              },
            }),
          ]
        : []),
    ]);

    res.status(201).json({ success: true, message: "Lampiran berhasil diunggah.", data: attachment });
  })
);

approvalRouter.delete(
  "/:approvalId/attachments/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const attachment = await prisma.approvalAttachment.findUnique({ where: { id } });
    if (!attachment || attachment.approvalId !== req.params.approvalId) throw new HttpError(404, "Lampiran tidak ditemukan.");
    await prisma.approvalAttachment.delete({ where: { id } });
    res.json({ success: true, message: "Lampiran berhasil dihapus." });
  })
);

// ===================== Dashboard =====================

approvalRouter.get(
  "/dashboard/summary",
  asyncRoute(async (req, res) => {
    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const finish = req.query.finish ? new Date(String(req.query.finish)) : undefined;

    const all = await prisma.approvalSchedule.findMany({
      select: { timestamp: true, finishApp: true, techName: true, plant: true },
    });

    const now = new Date();
    const ageBuckets = { lt7: 0, d7_14: 0, d14_30: 0, gt30: 0 };
    let totalApprovalPeriode = 0;
    let totalFinishPeriode = 0;
    const byTechName = new Map<string, number>();
    const byPlant = new Map<string, number>();

    for (const row of all) {
      if (row.finishApp) {
        const days = Math.floor((now.getTime() - row.finishApp.getTime()) / (1000 * 60 * 60 * 24));
        if (days < 7) ageBuckets.lt7++;
        else if (days < 14) ageBuckets.d7_14++;
        else if (days < 30) ageBuckets.d14_30++;
        else ageBuckets.gt30++;
      }

      if (start && finish) {
        if (row.timestamp >= start && row.timestamp <= finish) totalApprovalPeriode++;
        if (row.finishApp && row.finishApp >= start && row.finishApp <= finish) totalFinishPeriode++;
      }

      if (!row.finishApp) {
        const tech = row.techName || "(Belum ditentukan)";
        byTechName.set(tech, (byTechName.get(tech) ?? 0) + 1);
        const plant = row.plant || "(Belum ditentukan)";
        byPlant.set(plant, (byPlant.get(plant) ?? 0) + 1);
      }
    }

    const toSortedArray = (m: Map<string, number>) =>
      Array.from(m.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: {
        ageBuckets,
        totalApprovalPeriode,
        totalFinishPeriode,
        byTechName: toSortedArray(byTechName),
        byPlant: toSortedArray(byPlant),
      },
    });
  })
);
