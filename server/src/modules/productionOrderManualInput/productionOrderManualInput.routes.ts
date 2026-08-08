import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { sanitizeNik, sanitizeMembers } from "../../lib/employeeNik";

export const productionOrderManualInputRouter = Router();
productionOrderManualInputRouter.use(requireAuth);

const saveSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  orderQty: z.string().optional(),
  plant: z.string().optional(),
  iuPlant: z.string().optional(),
  codeTanki: z.string().optional(),
  start: z.coerce.date().optional().nullable(),
  finish: z.coerce.date().optional().nullable(),
  spvProduksi: z.string().trim().min(1, "SPV Produksi wajib diisi."),
  spvProduksiNik: z.string().trim().optional().nullable(),
  leader: z.string().optional(),
  leaderNik: z.string().trim().optional().nullable(),
  members: z
    .array(z.object({ name: z.string().trim().min(1), nik: z.string().trim().optional().nullable() }))
    .optional(),
});

productionOrderManualInputRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.productionOrderManualInput.findMany({ orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: rows });
  })
);

productionOrderManualInputRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const [spvProduksiNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvProduksiNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const created = await prisma.productionOrderManualInput.create({
      data: {
        ...parsed.data,
        spvProduksiNik,
        leaderNik,
        members: members as unknown as Prisma.InputJsonValue,
        inputBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "Data manual berhasil disimpan.", data: created });
  })
);

productionOrderManualInputRouter.put(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const existing = await prisma.productionOrderManualInput.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    const [spvProduksiNik, leaderNik, members] = await Promise.all([
      sanitizeNik(parsed.data.spvProduksiNik),
      sanitizeNik(parsed.data.leaderNik),
      sanitizeMembers(parsed.data.members),
    ]);
    const updated = await prisma.productionOrderManualInput.update({
      where: { id: req.params.id },
      data: { ...parsed.data, spvProduksiNik, leaderNik, members: members as unknown as Prisma.InputJsonValue },
    });
    res.json({ success: true, message: "Data manual berhasil diperbarui.", data: updated });
  })
);

productionOrderManualInputRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const existing = await prisma.productionOrderManualInput.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.productionOrderManualInput.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Data manual berhasil dihapus." });
  })
);
