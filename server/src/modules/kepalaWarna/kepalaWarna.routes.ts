import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";

/**
 * Stok Kepala Warna (Gudang Rak) -- 2026-11-13, instruksi eksplisit user:
 * adopsi logika macro VBA workbook "DATA KEPALA WARNA RAK 123.xlsm" (sheet
 * FORM INPUT/FORM OUTPUT/HIST IN OUT ZONA KEPALA WARNA/ZONA, macro
 * MASUK/KLRNEW/UPDMSTRNEW) ke web. Lihat `KwRackSlot`/`KwTransaction` di
 * schema.prisma utk pemetaan lengkap field Excel -> kolom di sini.
 *
 * Lookup Batch -> Order/Material Number/Material Description SENGAJA reuse
 * `MasterOrder` (sudah disync lewat Master Data > Referensi Order/PO, sumber
 * file SAP yg SAMA dgn yg dulu ditempel manual via macro `UPDMSTRNEW`) --
 * TIDAK ada tabel master baru di modul ini, menghindari duplikasi data &
 * sync terpisah.
 */
export const kepalaWarnaRouter = Router();
kepalaWarnaRouter.use(requireAuth);
kepalaWarnaRouter.use(requireMenuView("kepalaWarna"));

/** Turunan "RAK.IU1.A." dari "RAK.IU1.A.12" -- buang segmen angka paling
 * akhir, sisanya (termasuk titik penutup) jadi `zonaGroup`. */
function deriveZonaGroup(code: string): string {
  const match = code.match(/^(.*\.)\d+$/);
  return match ? match[1] : code;
}

// Lookup Batch -> Order/Material Number/Material Description & lookup "No PO
// Proses" -> Material Number/Description SENGAJA TIDAK diulang sbg endpoint
// di sini -- frontend reuse langsung `GET /master-data/orders/:order` &
// `GET /master-data/orders/by-batch/:batch` yg sudah ada (lewat komponen
// bersama <OrderLookup showBatchSearch>), sama sumber data (`MasterOrder`)
// dgn yg dipakai POST /transactions di bawah.

/// Lot/Exp otomatis dari Label Entry (ProductionLabel) kalau Order ini SUDAH
/// PERNAH print label (2026-11-13, instruksi eksplisit user) -- query
/// LANGSUNG ke `ProductionLabel` lewat Prisma (BUKAN panggil
/// `GET /production-label/latest-by-order/:order` yg sudah ada), supaya
/// user Stok Kepala Warna TIDAK perlu jg py akses menu "Label Entry SFG"
/// (endpoint itu digerbangi `requireMenuView("productionLabel")`) cuma utk
/// fitur autofill ini.
kepalaWarnaRouter.get(
  "/production-label/latest-by-order/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    const latest = await prisma.productionLabel.findFirst({
      where: { order },
      orderBy: { timestamp: "desc" },
      select: { lotNo: true, exp: true },
    });
    res.json({ success: true, data: latest });
  })
);

/// Lot/Exp FORM OUTPUT di Excel diambil dari transaksi Masuk terakhir utk
/// Batch yg sama (VLOOKUP ke HIST IN OUT ZONA KEPALA WARNA) -- FALLBACK
/// kalau Order-nya belum pernah print label (endpoint di atas kosong).
kepalaWarnaRouter.get(
  "/transactions/latest-in/:batch",
  asyncRoute(async (req, res) => {
    const batch = String(req.params.batch).trim();
    const latest = await prisma.kwTransaction.findFirst({
      where: { batch, type: "IN" },
      orderBy: { timestamp: "desc" },
      select: { lot: true, exp: true, rackCode: true },
    });
    res.json({ success: true, data: latest });
  })
);

/// Sheet ZONA, versi live -- kapasitas per `zonaGroup` DIHITUNG dari COUNT
/// slot (bukan kolom statis spt Excel).
kepalaWarnaRouter.get(
  "/zones",
  asyncRoute(async (_req, res) => {
    const slots = await prisma.kwRackSlot.findMany({ orderBy: { code: "asc" } });
    const groups = new Map<string, { zonaGroup: string; kapasitas: number; terisi: number }>();
    for (const slot of slots) {
      const g = groups.get(slot.zonaGroup) ?? { zonaGroup: slot.zonaGroup, kapasitas: 0, terisi: 0 };
      g.kapasitas += 1;
      if (slot.occupied) g.terisi += 1;
      groups.set(slot.zonaGroup, g);
    }
    res.json({ success: true, data: { slots, groups: Array.from(groups.values()) } });
  })
);

const createSlotSchema = z.object({
  code: z.string().trim().min(1, "Code Rak wajib diisi."),
});

/// Tambah slot rak baru ke master (Excel-nya daftar slot sudah statis sejak
/// awal lewat sheet LAYOUT zona -- di web ini bisa ditambah lewat UI).
kepalaWarnaRouter.post(
  "/zones",
  requireWrite,
  requireMenuInput("kepalaWarna"),
  asyncRoute(async (req, res) => {
    const parsed = createSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const code = parsed.data.code.trim().toUpperCase();
    const existing = await prisma.kwRackSlot.findUnique({ where: { code } });
    if (existing) throw new HttpError(409, `Code Rak "${code}" sudah ada.`);
    const created = await prisma.kwRackSlot.create({ data: { code, zonaGroup: deriveZonaGroup(code) } });
    res.status(201).json({ success: true, message: "Slot rak berhasil ditambahkan.", data: created });
  })
);

const transactionSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  rackCode: z.string().trim().min(1, "Zona/Code Rak wajib diisi."),
  batch: z.string().trim().min(1, "Batch wajib diisi."),
  qty: z.string().trim().min(1, "Qty wajib diisi."),
  /// Hanya dipakai type="IN" -- type="OUT" mengambil Lot/Exp dari transaksi
  /// Masuk terakhir utk Batch ini (lihat GET /transactions/latest-in).
  lot: z.string().optional(),
  exp: z.coerce.date().optional().nullable(),
  /// Khusus type="OUT".
  noPoProses: z.string().optional(),
  ket: z.string().optional(),
  /// Lewati peringatan konflik slot sudah terisi Batch lain (type="IN").
  force: z.boolean().optional(),
});

kepalaWarnaRouter.post(
  "/transactions",
  requireWrite,
  requireMenuInput("kepalaWarna"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = transactionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const { type, batch, qty, ket } = parsed.data;
    const rackCode = parsed.data.rackCode.trim().toUpperCase();

    const master = await prisma.masterOrder.findFirst({
      where: { batch },
      select: { order: true, materialNumber: true, materialDescription: true },
    });

    let slot = await prisma.kwRackSlot.findUnique({ where: { code: rackCode } });
    if (!slot) slot = await prisma.kwRackSlot.create({ data: { code: rackCode, zonaGroup: deriveZonaGroup(rackCode) } });

    if (type === "IN") {
      // Konflik slot sudah terisi Batch LAIN -- pola sama dgn peringatan
      // booking tanki (409, overridable `force`), supaya tidak ada 2 Batch
      // "menumpuk" diam-diam di 1 slot yg sama.
      if (slot.occupied && slot.currentBatch && slot.currentBatch !== batch && !parsed.data.force) {
        throw new HttpError(409, `Slot "${rackCode}" sedang terisi Batch "${slot.currentBatch}". Kosongkan dulu atau konfirmasi override.`);
      }

      const created = await prisma.kwTransaction.create({
        data: {
          type,
          rackCode,
          batch,
          materialNumber: master?.materialNumber ?? null,
          materialDescription: master?.materialDescription ?? null,
          noPo: master?.order ?? null,
          lot: parsed.data.lot ?? null,
          exp: parsed.data.exp ?? null,
          qty,
          ket: ket ?? null,
          inputBy: req.auth!.nik,
        },
      });
      await prisma.kwRackSlot.update({ where: { code: rackCode }, data: { occupied: true, currentBatch: batch } });
      res.status(201).json({ success: true, message: "Transaksi Masuk berhasil disimpan.", data: created });
      return;
    }

    // type === "OUT": Lot/Exp dari transaksi Masuk terakhir utk Batch ini,
    // Mat Code Proses/Item Proses dari Order tujuan pemakaian (No PO Proses).
    const latestIn = await prisma.kwTransaction.findFirst({
      where: { batch, type: "IN" },
      orderBy: { timestamp: "desc" },
      select: { lot: true, exp: true },
    });
    const masterProses = parsed.data.noPoProses
      ? await prisma.masterOrder.findUnique({
          where: { order: parsed.data.noPoProses },
          select: { materialNumber: true, materialDescription: true },
        })
      : null;

    const created = await prisma.kwTransaction.create({
      data: {
        type,
        rackCode,
        batch,
        materialNumber: master?.materialNumber ?? null,
        materialDescription: master?.materialDescription ?? null,
        noPo: master?.order ?? null,
        lot: latestIn?.lot ?? null,
        exp: latestIn?.exp ?? null,
        qty,
        noPoProses: parsed.data.noPoProses ?? null,
        matCodeProses: masterProses?.materialNumber ?? null,
        itemProses: masterProses?.materialDescription ?? null,
        ket: ket ?? null,
        inputBy: req.auth!.nik,
      },
    });
    // Kosongkan slot HANYA kalau Batch-nya memang masih yg sama -- defensif
    // kalau slot ternyata sudah ditimpa Batch lain di antara waktu itu.
    if (slot.currentBatch === batch) {
      await prisma.kwRackSlot.update({ where: { code: rackCode }, data: { occupied: false, currentBatch: null } });
    }
    res.status(201).json({ success: true, message: "Transaksi Keluar berhasil disimpan.", data: created });
  })
);

/// Histori gabungan IN & OUT (gantikan sheet HIST IN OUT ZONA KEPALA WARNA)
/// -- fetch semua baris spt modul log lain (bongkaran/packing/dst), filter &
/// virtualisasi baris dilakukan di frontend (DataTable).
kepalaWarnaRouter.get(
  "/transactions",
  asyncRoute(async (_req, res) => {
    const rows = await prisma.kwTransaction.findMany({ orderBy: { timestamp: "desc" } });
    res.json({ success: true, data: rows });
  })
);
