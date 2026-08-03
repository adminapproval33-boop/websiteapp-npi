import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { prisma } from "../../lib/prisma";
import { env } from "../../lib/env";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth, requireFullAccess, requireWrite } from "../../middleware/auth";

export const masterDataRouter = Router();

// Batas ukuran KHUSUS import Master Data (jauh lebih besar dari lampiran
// dokumen biasa) -- lihat catatan di env.ts (maxImportMb).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxImportMb * 1024 * 1024 },
});

masterDataRouter.use(requireAuth);

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase();
}

function findColumn(headers: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

/**
 * File .csv (kasus paling umum utk export SAP-COOISPI, bisa jutaan baris)
 * di-parse pakai `csv-parse` -- jauh lebih cepat daripada lewat model
 * objek Row/Cell milik ExcelJS. File .xlsx/.xls (biasanya lebih kecil,
 * mis. daftar Code Tanki) tetap lewat ExcelJS karena formatnya biner.
 */
async function parseWorkbook(buffer: Buffer, filename: string): Promise<unknown[][]> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true }) as unknown[][];
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // ExcelJS 1-indexed, index 0 kosong
    rows.push(values.slice(1));
  });
  return rows;
}

/// Kapan terakhir kali tiap kategori Master Data diimpor/diupdate (2026-08-03,
/// instruksi eksplisit user: pemberitahuan tanggal+jam update terakhir di
/// halaman Master Data). Dihitung dari MAX(updatedAt) tiap tabel -- field ini
/// otomatis ke-refresh Prisma (`@updatedAt`) baik lewat createMany (mode
/// replace) maupun upsert (mode append), jadi selalu mencerminkan import
/// terakhir tanpa kolom/tabel tambahan.
masterDataRouter.get(
  "/last-updated",
  asyncRoute(async (_req, res) => {
    const [orders, tanks, mesin, employees, flow] = await Promise.all([
      prisma.masterOrder.aggregate({ _max: { updatedAt: true } }),
      prisma.masterTank.aggregate({ _max: { updatedAt: true } }),
      prisma.masterMesin.aggregate({ _max: { updatedAt: true } }),
      prisma.masterEmployee.aggregate({ _max: { updatedAt: true } }),
      prisma.materialFlow.aggregate({ _max: { updatedAt: true } }),
    ]);
    res.json({
      success: true,
      data: {
        cooispi: orders._max.updatedAt,
        tanki: tanks._max.updatedAt,
        mesin: mesin._max.updatedAt,
        employee: employees._max.updatedAt,
        flow: flow._max.updatedAt,
      },
    });
  })
);

// ===================== Referensi Order/PO =====================

masterDataRouter.get(
  "/orders",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const orders = await prisma.masterOrder.findMany({
      where: search ? { order: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: { order: "asc" },
      take: 50,
    });
    res.json({ success: true, data: orders });
  })
);

masterDataRouter.get(
  "/orders/:order",
  asyncRoute(async (req, res) => {
    const order = await prisma.masterOrder.findUnique({ where: { order: String(req.params.order).trim() } });
    if (!order) {
      res.status(404).json({ success: false, message: "Order tidak ditemukan pada data referensi." });
      return;
    }
    res.json({ success: true, data: order });
  })
);

masterDataRouter.get(
  "/materials/:materialNumber",
  asyncRoute(async (req, res) => {
    const materialNumber = String(req.params.materialNumber).trim();
    const match = await prisma.masterOrder.findFirst({
      where: { materialNumber },
      select: { materialNumber: true, materialDescription: true },
    });
    if (!match) {
      res.status(404).json({ success: false, message: "Material Number tidak ditemukan pada data referensi." });
      return;
    }
    res.json({ success: true, data: match });
  })
);

/**
 * Cari IU Plant + Code Tanki paling baru untuk sebuah Order, lintas SEMUA
 * modul produksi (Premix/Aftermix, Milling, Colour Matching, Packing,
 * Approval, Check Results) -- bukan cuma data referensi SAP-COOISPI.
 * Tujuannya supaya begitu Order yang sama diketik lagi di proses
 * berikutnya (atau modul yang sama), data yang sudah pernah diinput
 * sebelumnya langsung muncul, mempercepat input. Ini cuma SARAN awal --
 * user tetap bebas menggantinya kalau datanya beda. Remark SENGAJA TIDAK
 * ikut disarankan lintas modul di sini -- tiap proses punya Remark-nya
 * sendiri-sendiri (lihat masing-masing halaman modul: fallback Remark-nya
 * dari histori modul itu SENDIRI, bukan dari endpoint ini).
 */
masterDataRouter.get(
  "/order-context/:order",
  asyncRoute(async (req, res) => {
    const order = String(req.params.order).trim();
    if (!order) {
      res.json({ success: true, data: null });
      return;
    }

    const [premix, milling, colourMatching, packing, approval, checkResult] = await Promise.all([
      prisma.premixAftermixLog.findFirst({
        where: { order },
        orderBy: { timestamp: "desc" },
        select: { iuPlant: true, codeTanki: true, section: true, timestamp: true },
      }),
      prisma.millingLog.findFirst({
        where: { order },
        orderBy: { timestamp: "desc" },
        select: { iuPlant: true, codeTanki1: true, timestamp: true },
      }),
      prisma.colourMatchingLog.findFirst({
        where: { order },
        orderBy: { timestamp: "desc" },
        select: { iuPlant: true, codeTanki: true, timestamp: true },
      }),
      prisma.packingLog.findFirst({
        where: { order },
        orderBy: { timestamp: "desc" },
        select: { iuPlant: true, codeTanki: true, timestamp: true },
      }),
      prisma.approvalSchedule.findFirst({
        where: { order },
        orderBy: { timestamp: "desc" },
        select: { iuPlant: true, codeTanki: true, timestamp: true },
      }),
      prisma.checkResult.findFirst({
        where: { order },
        orderBy: { timestamp: "desc" },
        select: { iuPlant: true, codeTanki: true, timestamp: true },
      }),
    ]);

    const candidates = [
      premix && {
        process: premix.section === "PREMIX" ? "Premix" : "Aftermix",
        iuPlant: premix.iuPlant,
        codeTanki: premix.codeTanki as string | null,
        timestamp: premix.timestamp,
      },
      milling && {
        process: "Milling",
        iuPlant: milling.iuPlant,
        codeTanki: milling.codeTanki1,
        timestamp: milling.timestamp,
      },
      colourMatching && {
        process: "Colour Matching",
        iuPlant: colourMatching.iuPlant,
        codeTanki: colourMatching.codeTanki as string | null,
        timestamp: colourMatching.timestamp,
      },
      packing && {
        process: "Packing",
        iuPlant: packing.iuPlant,
        codeTanki: packing.codeTanki as string | null,
        timestamp: packing.timestamp,
      },
      approval && {
        process: "Approval",
        iuPlant: approval.iuPlant,
        codeTanki: approval.codeTanki,
        timestamp: approval.timestamp,
      },
      checkResult && {
        process: "Input Check Results (QC)",
        iuPlant: checkResult.iuPlant,
        codeTanki: checkResult.codeTanki,
        timestamp: checkResult.timestamp,
      },
    ].filter((c): c is { process: string; iuPlant: string | null; codeTanki: string | null; timestamp: Date } => Boolean(c));

    candidates.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const latest = candidates[0];

    res.json({
      success: true,
      data: latest
        ? {
            iuPlant: latest.iuPlant ?? "",
            codeTanki: latest.codeTanki ?? "",
          }
        : null,
    });
  })
);

masterDataRouter.post(
  "/orders/import",
  requireFullAccess,
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "File wajib diunggah." });
      return;
    }
    const mode = req.body.mode === "append" ? "append" : "replace";

    const rows = await parseWorkbook(req.file.buffer, req.file.originalname);
    if (rows.length < 2) {
      res.status(400).json({ success: false, message: "File kosong atau tidak berisi data." });
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const col = {
      order: findColumn(headers, "order", "no order", "order number", "nomor order"),
      batch: findColumn(headers, "batch"),
      materialNumber: findColumn(headers, "material number", "material no", "no material"),
      materialDescription: findColumn(headers, "material description", "description", "deskripsi material"),
      orderQty: findColumn(headers, "order quantity (gmein)/liter", "order quantity", "qty", "quantity"),
      plant: findColumn(headers, "plant"),
      deliveredQtyLiter: findColumn(headers, "delivered quantity (gmein)/liter"),
      basicStartDate: findColumn(headers, "basic start date"),
      basicFinishDate: findColumn(headers, "basic finish date"),
      systemStatus: findColumn(headers, "system status"),
      unitOfMeasure: findColumn(headers, "unit of measure (=gmein)"),
      pctGR: findColumn(headers, "% gr"),
      actStartDate: findColumn(headers, "act start date"),
      actEndDate: findColumn(headers, "act end date"),
      volume: findColumn(headers, "volume"),
      deliveredQtyPcs: findColumn(headers, "delivered quantity (gmein) pcs", "delivered quantity (gmein)"),
      orderQtyPcs: findColumn(headers, "order quantity (gmein) pcs", "order quantity (gmein)"),
      abcIndicatorDescription: findColumn(headers, "abc indicator description"),
      todayAtp: findColumn(headers, "today-atp"),
      t7Atp: findColumn(headers, "t+7-atp"),
      jenis: findColumn(headers, "jenis"),
      warnaDasar: findColumn(headers, "warna dasar"),
      documentHeaderText: findColumn(headers, "document header text"),
      abcIndicator: findColumn(headers, "abc indicator"),
      orderType: findColumn(headers, "order type"),
    };

    if (col.order === -1) {
      res.status(400).json({
        success: false,
        message: 'Kolom "Order" tidak ditemukan di baris header file. Pastikan ada kolom bernama "Order".',
      });
      return;
    }

    const cell = (row: unknown[], idx: number) => (idx !== -1 ? String(row[idx] ?? "").trim() || null : null);

    const rawRecords = rows
      .slice(1)
      .map((row) => ({
        order: String(row[col.order] ?? "").trim(),
        batch: cell(row, col.batch),
        materialNumber: cell(row, col.materialNumber),
        materialDescription: cell(row, col.materialDescription),
        orderQty: cell(row, col.orderQty),
        plant: cell(row, col.plant),
        deliveredQtyLiter: cell(row, col.deliveredQtyLiter),
        basicStartDate: cell(row, col.basicStartDate),
        basicFinishDate: cell(row, col.basicFinishDate),
        systemStatus: cell(row, col.systemStatus),
        unitOfMeasure: cell(row, col.unitOfMeasure),
        pctGR: cell(row, col.pctGR),
        actStartDate: cell(row, col.actStartDate),
        actEndDate: cell(row, col.actEndDate),
        volume: cell(row, col.volume),
        deliveredQtyPcs: cell(row, col.deliveredQtyPcs),
        orderQtyPcs: cell(row, col.orderQtyPcs),
        abcIndicatorDescription: cell(row, col.abcIndicatorDescription),
        todayAtp: cell(row, col.todayAtp),
        t7Atp: cell(row, col.t7Atp),
        jenis: cell(row, col.jenis),
        warnaDasar: cell(row, col.warnaDasar),
        documentHeaderText: cell(row, col.documentHeaderText),
        abcIndicator: cell(row, col.abcIndicator),
        orderType: cell(row, col.orderType),
      }))
      .filter((r) => r.order.length > 0);

    if (rawRecords.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada baris data Order yang valid pada file." });
      return;
    }

    // Dedup by Order (baris terakhir menang) -- file referensi seperti export
    // SAP-COOISPI bisa berukuran puluhan ribu baris, jadi proses tulis ke DB
    // TIDAK dibungkus 1 transaction interaktif (default timeout Prisma 5 detik
    // akan gagal di skala ini) dan dilakukan bulk per-batch.
    const dedupMap = new Map<string, (typeof rawRecords)[number]>();
    for (const record of rawRecords) dedupMap.set(record.order, record);
    const records = Array.from(dedupMap.values());

    if (mode === "replace") {
      await prisma.masterOrder.deleteMany({});
      for (const batch of chunk(records, 8000)) {
        await prisma.masterOrder.createMany({ data: batch, skipDuplicates: true });
      }
    } else {
      for (const batch of chunk(records, 200)) {
        await Promise.all(
          batch.map((record) =>
            prisma.masterOrder.upsert({ where: { order: record.order }, create: record, update: record })
          )
        );
      }
    }

    res.json({ success: true, message: `${records.length} baris referensi Order berhasil diimpor (mode: ${mode}).` });
  })
);

// ===================== Daftar Code Tanki =====================

masterDataRouter.get(
  "/tanks",
  asyncRoute(async (_req, res) => {
    const tanks = await prisma.masterTank.findMany({ orderBy: { code: "asc" } });
    res.json({ success: true, data: tanks.map((t) => t.code) });
  })
);

/// Versi lengkap /tanks (semua kolom, bukan cuma code) -- dipakai tabel
/// Master Data Tanki. Endpoint /tanks di atas TETAP apa adanya (array
/// string polos) karena dipakai TankSelect (dropdown Code Tanki) di
/// banyak halaman lain.
masterDataRouter.get(
  "/tanks/full",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const tanks = await prisma.masterTank.findMany({
      where: search ? { code: { contains: search, mode: "insensitive" } } : undefined,
    });
    // Urut berdasarkan New Number -- numerik dulu (1, 2, 3, ...), yang bukan
    // angka (mis. "PAIL", "DRUM") ditaruh di akhir. `orderBy` Prisma/Postgres
    // biasa akan urut leksikografis ("10" sebelum "2"), makanya diurut manual.
    const toNum = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null);
    tanks.sort((a, b) => {
      const na = toNum(a.newNumber);
      const nb = toNum(b.newNumber);
      if (na !== null && nb !== null) return na - nb;
      if (na !== null) return -1;
      if (nb !== null) return 1;
      return (a.newNumber ?? "").localeCompare(b.newNumber ?? "");
    });
    res.json({ success: true, data: tanks });
  })
);

masterDataRouter.post(
  "/tanks/import",
  requireFullAccess,
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "File wajib diunggah." });
      return;
    }
    const mode = req.body.mode === "append" ? "append" : "replace";

    const rows = await parseWorkbook(req.file.buffer, req.file.originalname);
    if (rows.length < 2) {
      res.status(400).json({ success: false, message: "File kosong atau tidak berisi data." });
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const col = {
      code: findColumn(headers, "code tanki", "kode tanki", "code"),
      taTb: findColumn(headers, "ta/tb", "ta / tb", "tipe"),
      tankCapacity: findColumn(headers, "tank capacity", "kapasitas"),
      newNumber: findColumn(headers, "new number", "nomor baru"),
      locationPlant: findColumn(headers, "location / plant", "location/plant", "location", "plant", "lokasi"),
      typeTanki: findColumn(headers, "type tanki", "tipe tanki"),
    };
    // Fallback: file lama cuma 1 kolom polos tanpa header yang cocok -- anggap kolom pertama = Code Tanki.
    const codeCol = col.code !== -1 ? col.code : 0;

    const rawRecords = rows
      .slice(1)
      .map((row) => ({
        code: String(row[codeCol] ?? "").trim(),
        taTb: col.taTb !== -1 ? String(row[col.taTb] ?? "").trim() : null,
        tankCapacity: col.tankCapacity !== -1 ? String(row[col.tankCapacity] ?? "").trim() : null,
        newNumber: col.newNumber !== -1 ? String(row[col.newNumber] ?? "").trim() : null,
        locationPlant: col.locationPlant !== -1 ? String(row[col.locationPlant] ?? "").trim() : null,
        typeTanki: col.typeTanki !== -1 ? String(row[col.typeTanki] ?? "").trim() : null,
      }))
      .filter((r) => r.code.length > 0);

    if (rawRecords.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada kode tanki yang valid pada file." });
      return;
    }

    const dedupMap = new Map<string, (typeof rawRecords)[number]>();
    for (const record of rawRecords) dedupMap.set(record.code, record);
    const records = Array.from(dedupMap.values());

    if (mode === "replace") {
      await prisma.masterTank.deleteMany({});
      for (const batch of chunk(records, 5000)) {
        await prisma.masterTank.createMany({ data: batch, skipDuplicates: true });
      }
    } else {
      for (const batch of chunk(records, 200)) {
        await Promise.all(
          batch.map((record) =>
            prisma.masterTank.upsert({ where: { code: record.code }, create: record, update: record })
          )
        );
      }
    }

    res.json({ success: true, message: `${records.length} Code Tanki berhasil diimpor (mode: ${mode}).` });
  })
);

// ===================== Daftar Code Mesin =====================
// Sumber pertama: file "list mesin.xlsx" (2026-08-02, instruksi eksplisit
// user) -- kolom "No" (diabaikan), "Code Mesin Milling", "Lokasi". Dipakai
// Dashboard > Mesin Monitoring utk join by Code Mesin ke `codeMesin` di
// MillingLog, sama polanya dgn Master Data Tanki utk Tank Monitoring.

masterDataRouter.get(
  "/mesin",
  asyncRoute(async (_req, res) => {
    const mesin = await prisma.masterMesin.findMany({ orderBy: { code: "asc" } });
    res.json({ success: true, data: mesin.map((m) => m.code) });
  })
);

masterDataRouter.get(
  "/mesin/full",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const mesin = await prisma.masterMesin.findMany({
      where: search ? { code: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: { code: "asc" },
    });
    res.json({ success: true, data: mesin });
  })
);

masterDataRouter.post(
  "/mesin/import",
  requireFullAccess,
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "File wajib diunggah." });
      return;
    }
    const mode = req.body.mode === "append" ? "append" : "replace";

    const rows = await parseWorkbook(req.file.buffer, req.file.originalname);
    if (rows.length < 2) {
      res.status(400).json({ success: false, message: "File kosong atau tidak berisi data." });
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const col = {
      code: findColumn(headers, "code mesin milling", "code mesin", "kode mesin", "code"),
      lokasi: findColumn(headers, "lokasi", "location", "plant"),
    };
    // Fallback: file 1-kolom polos tanpa header yg cocok -- anggap kolom pertama = Code Mesin
    // (sama pola dgn fallback Code Tanki di atas).
    const codeCol = col.code !== -1 ? col.code : 0;

    const rawRecords = rows
      .slice(1)
      .map((row) => ({
        code: String(row[codeCol] ?? "").trim(),
        lokasi: col.lokasi !== -1 ? String(row[col.lokasi] ?? "").trim() || null : null,
      }))
      .filter((r) => r.code.length > 0);

    if (rawRecords.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada Code Mesin yang valid pada file." });
      return;
    }

    const dedupMap = new Map<string, (typeof rawRecords)[number]>();
    for (const record of rawRecords) dedupMap.set(record.code, record);
    const records = Array.from(dedupMap.values());

    if (mode === "replace") {
      await prisma.masterMesin.deleteMany({});
      for (const batch of chunk(records, 5000)) {
        await prisma.masterMesin.createMany({ data: batch, skipDuplicates: true });
      }
    } else {
      for (const batch of chunk(records, 200)) {
        await Promise.all(
          batch.map((record) =>
            prisma.masterMesin.upsert({ where: { code: record.code }, create: record, update: record })
          )
        );
      }
    }

    res.json({ success: true, message: `${records.length} Code Mesin berhasil diimpor (mode: ${mode}).` });
  })
);

/// Tambah 1 Code Mesin baru (2026-08-02, instruksi eksplisit user: tombol
/// "+Code Mesin" -- suatu saat ada mesin baru tanpa perlu re-upload seluruh
/// file). requireFullAccess sama spt endpoint import di atas.
masterDataRouter.post(
  "/mesin",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const code = String(req.body.code ?? "").trim();
    const lokasi = String(req.body.lokasi ?? "").trim() || null;
    if (!code) {
      res.status(400).json({ success: false, message: "Code Mesin wajib diisi." });
      return;
    }
    const existing = await prisma.masterMesin.findUnique({ where: { code } });
    if (existing) {
      res.status(400).json({ success: false, message: `Code Mesin "${code}" sudah terdaftar.` });
      return;
    }
    const created = await prisma.masterMesin.create({ data: { code, lokasi } });
    res.status(201).json({ success: true, message: "Code Mesin berhasil ditambahkan.", data: created });
  })
);

/// Edit Lokasi 1 Code Mesin (2026-08-02, instruksi eksplisit user: tombol
/// "Edit" di Dashboard > Mesin Monitoring -- dipakai SPV pas mesin
/// dipindah lokasi/plant). SENGAJA cuma Lokasi yg bisa diubah (bukan Code
/// itu sendiri) -- Code Mesin itu key yg dipakai join ke `codeMesin` histori
/// MillingLog, ganti Code = putus keterkaitan ke histori lama. requireWrite
/// (BUKAN requireFullAccess) krn ini koreksi rutin operasional, sama pola
/// dgn Save Colour Matching/dll -- beda dari tambah/hapus Code Mesin
/// (POST/DELETE di atas) yg tetap requireFullAccess krn itu perubahan
/// administratif daftar resmi mesin.
masterDataRouter.put(
  "/mesin/:code",
  requireWrite,
  asyncRoute(async (req, res) => {
    const code = String(req.params.code ?? "").trim();
    const lokasi = String(req.body.lokasi ?? "").trim() || null;
    const existing = await prisma.masterMesin.findUnique({ where: { code } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Code Mesin tidak ditemukan." });
      return;
    }
    const updated = await prisma.masterMesin.update({ where: { code }, data: { lokasi } });
    res.json({ success: true, message: `Lokasi Code Mesin "${code}" berhasil diperbarui.`, data: updated });
  })
);

/// Hapus 1 Code Mesin (2026-08-02, instruksi eksplisit user: tombol "-Code
/// Mesin" -- mesin rusak/tidak dipakai lagi). Hapus master data-nya SAJA --
/// histori MillingLog yg pernah pakai Code Mesin ini TETAP tersimpan apa
/// adanya (bukan foreign key), cuma tidak lagi muncul di daftar Mesin
/// Monitoring.
masterDataRouter.delete(
  "/mesin/:code",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const code = String(req.params.code ?? "").trim();
    const existing = await prisma.masterMesin.findUnique({ where: { code } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Code Mesin tidak ditemukan." });
      return;
    }
    await prisma.masterMesin.delete({ where: { code } });
    res.json({ success: true, message: `Code Mesin "${code}" berhasil dihapus.` });
  })
);

// ===================== Material Flow Proses =====================
// Rute proses baku per Material Number, sumbernya file "ALL FLOW PROSES.xlsx"
// (2026-07-31, instruksi eksplisit user) -- dipakai lib/stageGate.ts sbg
// sumber kebenaran resmi utk penguncian urutan tahap Input Proses.

masterDataRouter.get(
  "/material-flow",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const rows = await prisma.materialFlow.findMany({
      where: search
        ? {
            OR: [
              { materialNumber: { contains: search, mode: "insensitive" } },
              { materialDescription: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { materialNumber: "asc" },
      take: 5000,
    });
    res.json({ success: true, data: rows });
  })
);

masterDataRouter.post(
  "/material-flow/import",
  requireFullAccess,
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "File wajib diunggah." });
      return;
    }
    const mode = req.body.mode === "append" ? "append" : "replace";

    const rows = await parseWorkbook(req.file.buffer, req.file.originalname);
    if (rows.length < 2) {
      res.status(400).json({ success: false, message: "File kosong atau tidak berisi data." });
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const col = {
      materialNumber: findColumn(headers, "material code", "material number", "no material"),
      materialDescription: findColumn(headers, "material", "material description", "description"),
      premix: findColumn(headers, "premix"),
      milling: findColumn(headers, "milling"),
      aftermix: findColumn(headers, "aftermix"),
      colourMatching: findColumn(headers, "colour matching", "color matching"),
      qc: findColumn(headers, "qc"),
      approval: findColumn(headers, "approval"),
      packing: findColumn(headers, "packing"),
    };

    if (col.materialNumber === -1) {
      res.status(400).json({
        success: false,
        message: 'Kolom "Material Code" tidak ditemukan di baris header file. Pastikan ada kolom bernama "Material Code".',
      });
      return;
    }

    const filled = (v: unknown) => String(v ?? "").trim().length > 0;

    const rawRecords = rows
      .slice(1)
      .map((row) => ({
        materialNumber: String(row[col.materialNumber] ?? "").trim(),
        materialDescription: col.materialDescription !== -1 ? String(row[col.materialDescription] ?? "").trim() || null : null,
        premixRequired: col.premix !== -1 && filled(row[col.premix]),
        millingRequired: col.milling !== -1 && filled(row[col.milling]),
        aftermixRequired: col.aftermix !== -1 && filled(row[col.aftermix]),
        colourMatchingRequired: col.colourMatching !== -1 && filled(row[col.colourMatching]),
        qcRequired: col.qc !== -1 && filled(row[col.qc]),
        approvalRequired: col.approval !== -1 && filled(row[col.approval]),
        packingRequired: col.packing !== -1 && filled(row[col.packing]),
      }))
      .filter((r) => r.materialNumber.length > 0);

    if (rawRecords.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada baris Material Flow yang valid pada file." });
      return;
    }

    const dedupMap = new Map<string, (typeof rawRecords)[number]>();
    for (const record of rawRecords) dedupMap.set(record.materialNumber, record);
    const records = Array.from(dedupMap.values());

    if (mode === "replace") {
      await prisma.materialFlow.deleteMany({});
      for (const batch of chunk(records, 5000)) {
        await prisma.materialFlow.createMany({ data: batch, skipDuplicates: true });
      }
    } else {
      for (const batch of chunk(records, 200)) {
        await Promise.all(
          batch.map((record) =>
            prisma.materialFlow.upsert({ where: { materialNumber: record.materialNumber }, create: record, update: record })
          )
        );
      }
    }

    res.json({ success: true, message: `${records.length} Material Flow berhasil diimpor (mode: ${mode}).` });
  })
);

/// 1 record Material Flow (dipakai panel "Info Proses Material" di pop-up
/// "Tahap Selanjutnya" Production Order Monitoring, 2026-07-31, instruksi
/// eksplisit user) -- `null` kalau Material ini belum terdaftar sama sekali.
masterDataRouter.get(
  "/material-flow/:materialNumber",
  asyncRoute(async (req, res) => {
    const row = await prisma.materialFlow.findUnique({ where: { materialNumber: req.params.materialNumber } });
    res.json({ success: true, data: row });
  })
);

const MATERIAL_FLOW_BOOL_FIELDS = [
  "premixRequired",
  "millingRequired",
  "aftermixRequired",
  "colourMatchingRequired",
  "qcRequired",
  "approvalRequired",
  "packingRequired",
] as const;

/// Edit 7 tahap wajib/tidak utk 1 Material dari panel "Info Proses Material"
/// (2026-07-31, instruksi eksplisit user: "kolom edit yang terkoneksi dgn
/// master datanya") -- upsert (Material yg belum terdaftar di MaterialFlow
/// otomatis dibuatkan barunya, bukan ditolak). requireFullAccess krn ini
/// data resmi yg dipakai penguncian urutan tahap seluruh sistem
/// (lib/stageGate.ts), bukan sekadar preferensi tampilan.
masterDataRouter.put(
  "/material-flow/:materialNumber",
  requireFullAccess,
  asyncRoute(async (req, res) => {
    const materialNumber = req.params.materialNumber.trim();
    if (!materialNumber) {
      res.status(400).json({ success: false, message: "Material Number wajib diisi." });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const data: Record<string, boolean> = {};
    for (const field of MATERIAL_FLOW_BOOL_FIELDS) {
      if (field in body) data[field] = Boolean(body[field]);
    }

    const existing = await prisma.materialFlow.findUnique({ where: { materialNumber } });
    const row = existing
      ? await prisma.materialFlow.update({ where: { materialNumber }, data })
      : await prisma.materialFlow.create({
          data: {
            materialNumber,
            premixRequired: false,
            millingRequired: false,
            aftermixRequired: false,
            colourMatchingRequired: false,
            qcRequired: false,
            approvalRequired: false,
            packingRequired: false,
            ...data,
          },
        });
    res.json({ success: true, message: "Material Flow berhasil diperbarui.", data: row });
  })
);

// ===================== Data Karyawan =====================

masterDataRouter.get(
  "/employees",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const employees = await prisma.masterEmployee.findMany({
      where: search
        ? {
            OR: [
              { employeeId: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { fullName: "asc" },
      take: 500,
    });
    res.json({ success: true, data: employees });
  })
);

masterDataRouter.post(
  "/employees/import",
  requireFullAccess,
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "File wajib diunggah." });
      return;
    }
    const mode = req.body.mode === "append" ? "append" : "replace";

    const rows = await parseWorkbook(req.file.buffer, req.file.originalname);
    if (rows.length < 2) {
      res.status(400).json({ success: false, message: "File kosong atau tidak berisi data." });
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const col = {
      employeeId: findColumn(headers, "employee id", "nik", "no karyawan", "id karyawan"),
      fullName: findColumn(headers, "full name", "nama", "nama karyawan", "employee name"),
      organization: findColumn(headers, "organization", "organisasi"),
      jobPosition: findColumn(headers, "job position", "jabatan", "posisi", "position"),
      departemen: findColumn(headers, "departemen", "department", "dept"),
      plant: findColumn(headers, "plant"),
    };

    if (col.employeeId === -1) {
      res.status(400).json({
        success: false,
        message: 'Kolom "Employee ID" tidak ditemukan di baris header file. Pastikan ada kolom bernama "Employee ID".',
      });
      return;
    }
    if (col.fullName === -1) {
      res.status(400).json({
        success: false,
        message: 'Kolom "Full Name" tidak ditemukan di baris header file. Pastikan ada kolom bernama "Full Name".',
      });
      return;
    }

    const rawRecords = rows
      .slice(1)
      .map((row) => ({
        employeeId: String(row[col.employeeId] ?? "").trim(),
        fullName: String(row[col.fullName] ?? "").trim(),
        organization: col.organization !== -1 ? String(row[col.organization] ?? "").trim() : null,
        jobPosition: col.jobPosition !== -1 ? String(row[col.jobPosition] ?? "").trim() : null,
        departemen: col.departemen !== -1 ? String(row[col.departemen] ?? "").trim() : null,
        plant: col.plant !== -1 ? String(row[col.plant] ?? "").trim() : null,
      }))
      .filter((r) => r.employeeId.length > 0);

    if (rawRecords.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada baris data karyawan yang valid pada file." });
      return;
    }

    const dedupMap = new Map<string, (typeof rawRecords)[number]>();
    for (const record of rawRecords) dedupMap.set(record.employeeId, record);
    const records = Array.from(dedupMap.values());

    if (mode === "replace") {
      await prisma.masterEmployee.deleteMany({});
      for (const batch of chunk(records, 8000)) {
        await prisma.masterEmployee.createMany({ data: batch, skipDuplicates: true });
      }
    } else {
      for (const batch of chunk(records, 200)) {
        await Promise.all(
          batch.map((record) =>
            prisma.masterEmployee.upsert({ where: { employeeId: record.employeeId }, create: record, update: record })
          )
        );
      }
    }

    res.json({ success: true, message: `${records.length} data karyawan berhasil diimpor (mode: ${mode}).` });
  })
);
