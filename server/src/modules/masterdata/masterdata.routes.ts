import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { prisma } from "../../lib/prisma";
import { env } from "../../lib/env";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth, requireFullAccess } from "../../middleware/auth";

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
    };

    if (col.order === -1) {
      res.status(400).json({
        success: false,
        message: 'Kolom "Order" tidak ditemukan di baris header file. Pastikan ada kolom bernama "Order".',
      });
      return;
    }

    const rawRecords = rows
      .slice(1)
      .map((row) => ({
        order: String(row[col.order] ?? "").trim(),
        batch: col.batch !== -1 ? String(row[col.batch] ?? "").trim() : null,
        materialNumber: col.materialNumber !== -1 ? String(row[col.materialNumber] ?? "").trim() : null,
        materialDescription:
          col.materialDescription !== -1 ? String(row[col.materialDescription] ?? "").trim() : null,
        orderQty: col.orderQty !== -1 ? String(row[col.orderQty] ?? "").trim() : null,
        plant: col.plant !== -1 ? String(row[col.plant] ?? "").trim() : null,
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
