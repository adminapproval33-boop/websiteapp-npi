import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { isValidTankCode } from "../../lib/tankCode";

export const tankManualInputRouter = Router();
tankManualInputRouter.use(requireAuth);

const saveSchema = z.object({
  codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  orderQty: z.string().optional(),
  remark: z.string().optional(),
});

tankManualInputRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.tankManualInput.findMany({ orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: rows });
  })
);

tankManualInputRouter.post(
  "/",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (!(await isValidTankCode(parsed.data.codeTanki))) {
      res.status(400).json({ success: false, message: "Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar." });
      return;
    }
    const created = await prisma.tankManualInput.create({
      data: { ...parsed.data, inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Data manual tank berhasil disimpan.", data: created });
  })
);

tankManualInputRouter.put(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (!(await isValidTankCode(parsed.data.codeTanki))) {
      res.status(400).json({ success: false, message: "Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar." });
      return;
    }
    const existing = await prisma.tankManualInput.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    const updated = await prisma.tankManualInput.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ success: true, message: "Data manual tank berhasil diperbarui.", data: updated });
  })
);

tankManualInputRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const existing = await prisma.tankManualInput.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.tankManualInput.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Data manual tank berhasil dihapus." });
  })
);
