import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { getLatestCrossModule, isValidTankCodeOrJoined } from "../../lib/productionLabelHelpers";

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
  plant: z.string().optional(),
  lotNo: z.string().optional(),
  exp: optionalDate,
  shelfLife: z.string().optional(),
  codeTanki: z.string().optional(),
  iuPlant: z.string().optional(),
  pasteType: z.string().optional(),
  drumColour: z.string().optional(),
  /// Volume (2026-08-20, instruksi eksplisit user, KHUSUS FG) -- lihat komentar kolom di schema.prisma.
  volume: z.string().optional(),
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

productionLabelFgRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.productionLabelFg.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.productionLabelFg.delete({ where: { id } });
    res.json({ success: true, message: "Data berhasil dihapus." });
  })
);
