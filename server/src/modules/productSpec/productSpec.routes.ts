import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";

export const productSpecRouter = Router();
productSpecRouter.use(requireAuth);
productSpecRouter.use(requireMenuView("productSpec"));

const parameterSchema = z.object({
  no: z.number().int(),
  itemCheck: z.string().trim().min(1, "Item Check wajib diisi."),
  standardSpec: z.string().optional(),
  unit: z.string().optional(),
  remark: z.string().optional(),
});

const saveSchema = z.object({
  materialNumber: z.string().trim().min(1, "Material Number wajib diisi."),
  materialDescription: z.string().trim().min(1, "Material Description wajib diisi."),
  information: z.string().optional(),
  parameters: z.array(parameterSchema).min(1, "Minimal 1 baris Spec Parameter wajib diisi."),
});

/**
 * Dipakai dari "Input Check Results" supaya Spec Parameters (Item Check +
 * Standard/Spec) otomatis terisi dari Product Spek yang sudah dibuat utk
 * Material Number tsb (bukan diketik manual) -- menghubungkan kedua menu.
 * Mengembalikan Spec TERBARU kalau ada lebih dari satu versi utk material yg sama.
 */
productSpecRouter.get(
  "/by-material/:materialNumber",
  asyncRoute(async (req, res) => {
    const materialNumber = String(req.params.materialNumber).trim();
    const spec = await prisma.productSpec.findFirst({
      where: { materialNumber },
      include: { parameters: { orderBy: { no: "asc" } } },
      orderBy: { timestamp: "desc" },
    });
    if (!spec) {
      res.status(404).json({
        success: false,
        message: "Belum ada Product Spek untuk Material Number ini. Silakan buat dulu di menu Creating Product Spek.",
      });
      return;
    }
    res.json({ success: true, data: spec });
  })
);

productSpecRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const finish = req.query.finish ? new Date(String(req.query.finish)) : undefined;

    const specs = await prisma.productSpec.findMany({
      where: {
        AND: [
          search
            ? {
                OR: [
                  { materialNumber: { contains: search, mode: "insensitive" } },
                  { materialDescription: { contains: search, mode: "insensitive" } },
                ],
              }
            : {},
          start ? { timestamp: { gte: start } } : {},
          finish ? { timestamp: { lte: finish } } : {},
        ],
      },
      include: { parameters: { orderBy: { no: "asc" } } },
      orderBy: { timestamp: "desc" },
      take: 500,
    });

    res.json({ success: true, data: specs });
  })
);

productSpecRouter.post(
  "/",
  requireWrite,
  requireMenuInput("productSpec"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const { parameters, ...header } = parsed.data;
    const spec = await prisma.productSpec.create({
      data: {
        ...header,
        inputBy: req.auth!.nik,
        parameters: { create: parameters },
      },
      include: { parameters: true },
    });
    res.status(201).json({ success: true, message: "Data Spec berhasil disimpan.", data: spec });
  })
);

productSpecRouter.put(
  "/:specId",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const specId = req.params.specId;
    const existing = await prisma.productSpec.findUnique({ where: { specId } });
    if (!existing) throw new HttpError(404, "Data Spec tidak ditemukan.");

    const { parameters, ...header } = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.productSpecParameter.deleteMany({ where: { specId } });
      return tx.productSpec.update({
        where: { specId },
        data: { ...header, parameters: { create: parameters } },
        include: { parameters: { orderBy: { no: "asc" } } },
      });
    });

    res.json({ success: true, message: "Data Spec berhasil diperbarui.", data: updated });
  })
);

productSpecRouter.delete(
  "/:specId",
  requireMenuInput("productSpec"),
  asyncRoute(async (req, res) => {
    const specId = req.params.specId;
    const existing = await prisma.productSpec.findUnique({ where: { specId } });
    if (!existing) throw new HttpError(404, "Data Spec tidak ditemukan.");
    await prisma.productSpec.delete({ where: { specId } });
    res.json({ success: true, message: "Data Spec berhasil dihapus." });
  })
);
