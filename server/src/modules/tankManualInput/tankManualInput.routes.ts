import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { isValidTankCode } from "../../lib/tankCode";
import { bookingRemark } from "../../lib/tankBooking";

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

// Booking tanki dari pop-up Info Proses (2026-09-20, instruksi eksplisit user,
// lihat lib/tankBooking.ts) -- SENGAJA requireWrite (bukan requireFullAccess spt
// PUT/DELETE di bawah): user akses Input yg salah pilih tanki harus bisa
// membatalkan sendiri. Pembatalan cuma menyentuh entri booking (awalan remark),
// TIDAK PERNAH entri Input Manual biasa.
const bookingSchema = z.object({
  section: z.enum(["PREMIX", "AFTERMIX"]),
  codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  orderQty: z.string().optional(),
  note: z.string().optional(),
  // Kosong ("" / null) = tidak diisi; string datetime-local dari form di-coerce
  // spt field tanggal lain di app ini. SENGAJA tanpa cek "tidak boleh masa depan"
  // -- rencana mulai justru biasanya di masa depan.
  plannedStart: z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.date()])
    .transform((v) => (v ? v : null)),
});

// Daftar entri booking (bukan Input Manual biasa) utk 1 Order -- dipakai pop-up
// Info Proses utk nampilin Rencana Mulai & pemesan. `inputBy` = NIK; frontend
// yg mengubahnya jadi "Nama (NIK)" (formatInputBy), sama pola menu History.
tankManualInputRouter.get(
  "/booking",
  asyncRoute(async (req, res) => {
    const order = String(req.query.order ?? "").trim();
    if (!order) {
      res.status(400).json({ success: false, message: "Order wajib diisi." });
      return;
    }
    const rows = await prisma.tankManualInput.findMany({
      where: {
        order,
        OR: [{ remark: { startsWith: "Booking Premix" } }, { remark: { startsWith: "Booking Aftermix" } }],
      },
      orderBy: { timestamp: "desc" },
      select: { id: true, codeTanki: true, remark: true, plannedStart: true, inputBy: true, timestamp: true },
    });
    // Nama pemesan: akun aplikasi (User) dulu, lalu Data Karyawan; kalau tidak
    // ketemu di keduanya, frontend tampilkan NIK apa adanya.
    const niks = Array.from(new Set(rows.map((r) => r.inputBy)));
    const [users, employees] = await Promise.all([
      prisma.user.findMany({ where: { nik: { in: niks } }, select: { nik: true, name: true } }),
      prisma.masterEmployee.findMany({ where: { employeeId: { in: niks } }, select: { employeeId: true, fullName: true } }),
    ]);
    const nameByNik = new Map<string, string>([
      ...employees.map((e) => [e.employeeId, e.fullName] as [string, string]),
      ...users.map((u) => [u.nik, u.name] as [string, string]),
    ]);
    res.json({ success: true, data: rows.map((r) => ({ ...r, inputByName: nameByNik.get(r.inputBy) ?? null })) });
  })
);

tankManualInputRouter.post(
  "/booking",
  requireWrite,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const { section, note, ...rest } = parsed.data;
    if (!(await isValidTankCode(rest.codeTanki))) {
      res.status(400).json({ success: false, message: "Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar." });
      return;
    }
    const created = await prisma.tankManualInput.create({
      data: { ...rest, remark: bookingRemark(section, note), inputBy: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Booking tanki berhasil disimpan.", data: created });
  })
);

const cancelBookingSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  codeTanki: z.string().trim().min(1, "Code Tanki wajib diisi."),
});

tankManualInputRouter.post(
  "/booking/cancel",
  requireWrite,
  asyncRoute(async (req, res) => {
    const parsed = cancelBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const result = await prisma.tankManualInput.deleteMany({
      where: {
        order: parsed.data.order,
        codeTanki: parsed.data.codeTanki,
        OR: [{ remark: { startsWith: "Booking Premix" } }, { remark: { startsWith: "Booking Aftermix" } }],
      },
    });
    if (result.count === 0) throw new HttpError(404, "Booking tanki tidak ditemukan.");
    res.json({ success: true, message: "Booking tanki dibatalkan." });
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
