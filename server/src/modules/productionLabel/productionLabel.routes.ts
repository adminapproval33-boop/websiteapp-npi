import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { isValidTankCode } from "../../lib/tankCode";

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
  lotNo: z.string().optional(),
  exp: optionalDate,
  shelfLife: z.string().optional(),
  codeTanki: z.string().optional(),
  iuPlant: z.string().optional(),
  pasteType: z.string().optional(),
  drumColour: z.string().optional(),
  remark: z.string().optional(),
});

interface CrossModuleCandidate {
  timestamp: Date;
  codeTanki: string | null;
  iuPlant: string | null;
  remark: string | null;
}

/** codeTanki/iuPlant/remark diambil dari input TERAKHIR (by timestamp)
 * across Premix/Aftermix/Milling/Approval/Admin QC utk Order ini (2026-08-04,
 * instruksi eksplisit user) -- 1 baris "pemenang" dipakai utuh (bukan
 * campur field dari baris berbeda) supaya kombinasi tanki/plant/remark-nya
 * tetap konsisten satu sama lain. Tetap bisa dioverride manual oleh operator
 * di form sebelum cetak. MillingLog py DUA kolom tanki (codeTanki1/2, beda
 * dari modul lain yg cuma 1) -- digabung jadi satu string "A / B". */
async function getLatestCrossModule(order: string) {
  const [premixAftermix, milling, approval, adminQc] = await Promise.all([
    prisma.premixAftermixLog.findFirst({ where: { order }, orderBy: { timestamp: "desc" } }),
    prisma.millingLog.findFirst({ where: { order }, orderBy: { timestamp: "desc" } }),
    prisma.approvalSchedule.findFirst({ where: { order }, orderBy: { timestamp: "desc" } }),
    prisma.adminQc.findFirst({ where: { order }, orderBy: { timestamp: "desc" } }),
  ]);

  const candidates: CrossModuleCandidate[] = [];
  if (premixAftermix) {
    candidates.push({
      timestamp: premixAftermix.timestamp,
      codeTanki: premixAftermix.codeTanki,
      iuPlant: premixAftermix.iuPlant,
      remark: premixAftermix.remark,
    });
  }
  if (milling) {
    candidates.push({
      timestamp: milling.timestamp,
      // Dedupe dulu (2026-08-08, bug fix): kalau Couple & Moving kebetulan
      // tanki fisik yg SAMA (codeTanki1 === codeTanki2), gabungan tanpa
      // dedupe menghasilkan "X / X" yg membingungkan di Production Label --
      // tanki yg beda2 tetap tampil keduanya spt sebelumnya.
      codeTanki: Array.from(new Set([milling.codeTanki1, milling.codeTanki2].filter(Boolean))).join(" / ") || null,
      iuPlant: milling.iuPlant,
      remark: milling.remark,
    });
  }
  if (approval) {
    candidates.push({
      timestamp: approval.timestamp,
      codeTanki: approval.codeTanki,
      iuPlant: approval.iuPlant,
      remark: approval.remark,
    });
  }
  if (adminQc) {
    candidates.push({
      timestamp: adminQc.timestamp,
      codeTanki: adminQc.codeTanki,
      iuPlant: adminQc.iuPlant,
      remark: adminQc.remark,
    });
  }

  if (candidates.length === 0) return { codeTanki: null, iuPlant: null, remark: null };
  candidates.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const { codeTanki, iuPlant, remark } = candidates[0];
  return { codeTanki, iuPlant, remark };
}

/** Validasi Code Tanki -- SENGAJA dipisah dari isValidTankCode polos krn
 * field ini SATU-SATUNYA yg boleh berisi gabungan 2 tanki "A / B" (autofill
 * dari MillingLog.codeTanki1/2 yg beda, lihat getLatestCrossModule di atas)
 * -- tiap bagian yg dipisah " / " divalidasi sendiri-sendiri thd Master
 * Data Tanki, bukan seluruh string sekaligus. */
async function isValidTankCodeOrJoined(value: string): Promise<boolean> {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parts = trimmed.split(" / ").map((p) => p.trim());
  const results = await Promise.all(parts.map((p) => isValidTankCode(p)));
  return results.every(Boolean);
}

productionLabelRouter.get(
  "/latest-cross-module/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const data = await getLatestCrossModule(order);
    res.json({ success: true, data });
  })
);

productionLabelRouter.get(
  "/history",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.productionLabel.findMany({ orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: rows });
  })
);

/// "Cetak Label" -- setiap kali dicetak, dibikinkan baris History baru (BUKAN
/// mode Edit/replace spt modul lain) krn tiap print adalah kejadian terpisah,
/// termasuk kalau Order yg sama dicetak ulang.
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

productionLabelRouter.delete(
  "/:id",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const existing = await prisma.productionLabel.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Data tidak ditemukan.");
    await prisma.productionLabel.delete({ where: { id } });
    res.json({ success: true, message: "Data berhasil dihapus." });
  })
);
