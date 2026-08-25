import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { getLatestCrossModule, isValidTankCodeOrJoined } from "../../lib/productionLabelHelpers";
import { notFutureDDMMYYYY } from "../../lib/dateValidation";

export const productionLabelRouter = Router();
productionLabelRouter.use(requireAuth);
productionLabelRouter.use(requireMenuView("productionLabel"));

const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  orderQty: z.string().optional(),
  plant: z.string().optional(),
  // exp ("Expired") SENGAJA TIDAK divalidasi -- itu tanggal kedaluwarsa hasil
  // hitung Lot No + Shelf Life, wajar di masa depan by design.
  lotNo: notFutureDDMMYYYY(z.string().optional(), "Lot No"),
  exp: optionalDate,
  shelfLife: z.string().optional(),
  codeTanki: z.string().optional(),
  iuPlant: z.string().optional(),
  pasteType: z.string().optional(),
  drumColour: z.string().optional(),
  remark: z.string().optional(),
});

productionLabelRouter.get(
  "/latest-cross-module/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const data = await getLatestCrossModule(order);
    res.json({ success: true, data });
  })
);

/// Daftar SEMUA tanki (baris MillingLog) milik 1 Order (2026-08-25, instruksi
/// eksplisit user) -- dipakai dropdown "Pilih Tanki" di form Label Entry SFG,
/// supaya operator bisa cetak label utk tanki 1/2/3/dst (bukan cuma tanki
/// TERAKHIR yg diinput spt sebelumnya lewat getLatestCrossModule). Query
/// LANGSUNG ke prisma.millingLog (BUKAN via GET /milling/by-order/:order)
/// supaya TIDAK ikut kena gerbang requireMenuView("milling") -- user yg py
/// akses Label Entry SFG tapi TIDAK py akses menu Milling tetap harus bisa
/// pilih tanki di sini, sama pola dgn getLatestCrossModule yg jg baca lintas
/// modul tanpa terikat akses menu asalnya. Urutan ASC (bukan DESC) supaya
/// nomor "Tanki N" konsisten dgn penomoran di panel "Tanki Turunan Order Ini"
/// (MillingPage.tsx, lihat GET /milling/by-order/:order).
productionLabelRouter.get(
  "/milling-tanks/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const rows = await prisma.millingLog.findMany({
      where: { order },
      select: { id: true, codeTanki1: true, codeTanki2: true, iuPlant: true, remark: true },
      orderBy: { timestamp: "asc" },
    });
    const data = rows.map((r, i) => ({
      id: r.id,
      label: `Tanki ${i + 1}`,
      codeTanki: Array.from(new Set([r.codeTanki1, r.codeTanki2].filter(Boolean))).join(" / ") || null,
      iuPlant: r.iuPlant,
      remark: r.remark,
    }));
    res.json({ success: true, data });
  })
);

/// Dipakai panel "Info Proses Material" (baris "Production Label") utk tahu
/// apakah Order ini SUDAH PERNAH dicetak labelnya, supaya kolom "Status
/// Order Ini" bisa tampil "Selesai" (2026-08-12, instruksi eksplisit user)
/// -- sama pola dgn GET /bongkaran/latest-by-order/:order. Dipakai JUGA oleh
/// ProductionLabelEntryPage.tsx sendiri (2026-08-20) utk autofill semua
/// kolom manual begitu Order yg SUDAH PERNAH masuk History dicari lagi.
productionLabelRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.productionLabel.findFirst({ where: { order }, orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: latest });
  })
);

/// Material Type/Drum Colour TERAKHIR utk Material Number ini, LINTAS Order
/// manapun di History Label Entry SFG (2026-08-25, instruksi eksplisit user:
/// mempercepat input admin -- kalau Material Number yg sama PERNAH dicetak
/// sebelumnya di Order lain, Material Type/Drum Colour-nya biasanya SAMA krn
/// itu properti Material itu sendiri, bukan Order-nya). Dipakai SEBAGAI
/// FALLBACK di ProductionLabelEntryPage.tsx -- KALAH prioritas dari autofill
/// Order-spesifik (/latest-by-order/:order di atas) yg sudah ada, cuma
/// dipakai kalau Order yg lagi dicari BELUM PERNAH masuk History sendiri.
/// Hasilnya tetap bisa diedit manual spt biasa (bukan read-only) -- murni
/// saran awal, bukan penguncian nilai.
productionLabelRouter.get(
  "/latest-by-material/:materialNumber",
  asyncRoute(async (req, res) => {
    const materialNumber = String(req.params.materialNumber).trim();
    const latest = materialNumber
      ? await prisma.productionLabel.findFirst({ where: { materialNumber }, orderBy: { timestamp: "desc" } })
      : null;
    res.json({ success: true, data: latest });
  })
);

productionLabelRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.productionLabel.findMany({ orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: rows });
  })
);

/// "Cetak Label"/"Save" -- setiap kali disimpan, dibikinkan baris History
/// baru (BUKAN mode Edit/replace spt modul lain) krn tiap print/save adalah
/// kejadian terpisah, termasuk kalau Order yg sama dicetak/disimpan ulang.
productionLabelRouter.post(
  "/",
  requireWrite,
  requireMenuInput("productionLabel"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (parsed.data.codeTanki && !(await isValidTankCodeOrJoined(parsed.data.codeTanki))) {
      res.status(400).json({ success: false, message: "Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar." });
      return;
    }
    const created = await prisma.productionLabel.create({
      data: { ...parsed.data, printedBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Label berhasil dicetak & disimpan ke History.", data: created });
  })
);

/// Edit baris History (2026-08-25, instruksi eksplisit user) -- akses SAMA
/// dgn Save (requireMenuInput), BUKAN lagi requireFullAccess spt Hapus di
/// bawah dulunya, supaya user level INPUT bisa perbaiki salah input tanpa
/// perlu hapus + cetak ulang.
productionLabelRouter.put(
  "/:id",
  requireWrite,
  requireMenuInput("productionLabel"),
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.productionLabel.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (parsed.data.codeTanki && !(await isValidTankCodeOrJoined(parsed.data.codeTanki))) {
      res.status(400).json({ success: false, message: "Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar." });
      return;
    }
    const updated = await prisma.productionLabel.update({ where: { id }, data: parsed.data });
    res.json({ success: true, message: "Data berhasil diperbarui.", data: updated });
  })
);

/// Hapus (2026-08-25, instruksi eksplisit user) -- dibuka dari FULL_ACCESS-only
/// jadi requireMenuInput (level INPUT ke atas), sama gerbangnya dgn Save/Edit
/// di atas, bukan lagi requireFullAccess.
productionLabelRouter.delete(
  "/:id",
  requireWrite,
  requireMenuInput("productionLabel"),
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.productionLabel.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.productionLabel.delete({ where: { id } });
    res.json({ success: true, message: "Data berhasil dihapus." });
  })
);
