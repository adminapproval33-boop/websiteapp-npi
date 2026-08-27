import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { getLatestCrossModule, isValidTankCodeOrJoined } from "../../lib/productionLabelHelpers";
import { notFutureDDMMYYYY } from "../../lib/dateValidation";

/// Label Entry FG (2026-08-20, instruksi eksplisit user) -- SAMA PERSIS
/// dgn productionLabel.routes.ts (Label Entry SFG), cuma beda model Prisma
/// (`productionLabelFg`, tabel `production_labels_fg`) & menu key
/// ("productionLabelFg") supaya History-nya TERPISAH TOTAL dari SFG, sesuai
/// instruksi eksplisit user (bukan 1 tabel dibedakan kolom tipe).
export const productionLabelFgRouter = Router();
productionLabelFgRouter.use(requireAuth);
productionLabelFgRouter.use(requireMenuView("productionLabelFg"));

const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const saveSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  orderQty: z.string().optional(),
  /// "Order quantity (GMEIN)" varian Pcs (2026-08-21, instruksi eksplisit user, KHUSUS FG) -- lihat komentar kolom di schema.prisma.
  orderQtyPcs: z.string().optional(),
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
  /// Volume (2026-08-20, instruksi eksplisit user, KHUSUS FG) -- lihat komentar kolom di schema.prisma.
  volume: z.string().optional(),
  /// "Jumlah /Per" (2026-08-21, instruksi eksplisit user, KHUSUS FG) -- lihat komentar kolom di schema.prisma.
  jumlahPer: z.string().optional(),
  remark: z.string().optional(),
});

productionLabelFgRouter.get(
  "/latest-cross-module/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const data = await getLatestCrossModule(order);
    res.json({ success: true, data });
  })
);

productionLabelFgRouter.get(
  "/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.productionLabelFg.findFirst({ where: { order }, orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: latest });
  })
);

/// Autofill "Shelf Life (bulan)" dari Material Number yg SAMA di Order LAIN
/// (2026-08-27, instruksi eksplisit user) -- Shelf Life properti Material,
/// bukan Order, jadi wajar disamakan lintas Order kalau Material ini pernah
/// diinput sebelumnya. Sama pola persis dgn
/// productionLabel.routes.ts (SFG) -- endpoint ini KHUSUS ada di FG krn
/// SFG belum pernah diminta fitur ini utk Shelf Life (SFG pakai endpoint
/// serupa cuma utk Material Type/Drum Colour).
productionLabelFgRouter.get(
  "/latest-by-material/:materialNumber",
  asyncRoute(async (req, res) => {
    const materialNumber = String(req.params.materialNumber).trim();
    const latest = materialNumber
      ? await prisma.productionLabelFg.findFirst({ where: { materialNumber }, orderBy: { timestamp: "desc" } })
      : null;
    res.json({ success: true, data: latest });
  })
);

productionLabelFgRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.productionLabelFg.findMany({ orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: rows });
  })
);

/// "Cetak Label"/"Save" -- setiap kali disimpan, dibikinkan baris History
/// baru (BUKAN mode Edit/replace), sama pola dgn Label Entry SFG.
productionLabelFgRouter.post(
  "/",
  requireWrite,
  requireMenuInput("productionLabelFg"),
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
    const created = await prisma.productionLabelFg.create({
      data: { ...parsed.data, printedBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Label berhasil dicetak & disimpan ke History.", data: created });
  })
);

/// Edit baris History (2026-08-25, instruksi eksplisit user) -- akses SAMA
/// dgn Save (requireMenuInput), BUKAN lagi requireFullAccess spt Hapus di
/// bawah dulunya, supaya user level INPUT bisa perbaiki salah input tanpa
/// perlu hapus + cetak ulang.
productionLabelFgRouter.put(
  "/:id",
  requireWrite,
  requireMenuInput("productionLabelFg"),
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.productionLabelFg.findUnique({ where: { id } });
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
    const updated = await prisma.productionLabelFg.update({ where: { id }, data: parsed.data });
    res.json({ success: true, message: "Data berhasil diperbarui.", data: updated });
  })
);

/// Hapus (2026-08-25, instruksi eksplisit user) -- dibuka dari FULL_ACCESS-only
/// jadi requireMenuInput (level INPUT ke atas), sama gerbangnya dgn Save/Edit
/// di atas, bukan lagi requireFullAccess.
productionLabelFgRouter.delete(
  "/:id",
  requireWrite,
  requireMenuInput("productionLabelFg"),
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.productionLabelFg.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.productionLabelFg.delete({ where: { id } });
    res.json({ success: true, message: "Data berhasil dihapus." });
  })
);
