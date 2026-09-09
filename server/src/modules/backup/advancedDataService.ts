import ExcelJS from "exceljs";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

/** Sistem Import & Export Data Advance (2026-09-09, instruksi eksplisit user:
 * "fitur import & export advance yang mengandung semua data termasuk Master
 * data, transaksi data, log data, dashboard data, dll"). BEDA dari Sistem
 * Backup (backupService.ts, pg_dump/pg_restore -- 1 file binary, seluruh DB
 * sekaligus, tidak bisa dibaca manusia): fitur ini per-kategori/per-tabel,
 * formatnya Excel (1 sheet = 1 tabel) supaya bisa dibuka/diedit/diaudit
 * manual, dan bisa dipakai utk mindahkan data SEBAGIAN (mis. cuma Master
 * Data) antar lingkungan, bukan cuma disaster-recovery.
 *
 * "Data Dashboard" SENGAJA TIDAK jadi kategori sendiri -- semua Dashboard di
 * app ini murni VIEW terhitung dari tabel Master Data + Transaksi/Log yang
 * sudah tercakup di bawah (lihat dashboard.routes.ts, tidak ada tabel
 * Dashboard tersendiri), jadi sudah otomatis ikut ter-export/import lewat 2
 * kategori itu.
 *
 * `User`/`Session` SENGAJA DIKECUALIKAN dari seluruh fitur ini (beda dari
 * Sistem Backup yg pg_dump-nya tetap mencakup semuanya) -- User berisi
 * passwordHash, dan file .xlsx jauh lebih mudah dibuka/disebar tanpa sengaja
 * drpd file .dump biner. Kalau perlu pulihkan akun user, pakai Sistem Backup
 * (Restore) yang sudah ada, bukan fitur ini.
 */

export type AdvancedCategory = "master" | "transaksi" | "qc_approval" | "sosial";

export const CATEGORY_LABELS: Record<AdvancedCategory, string> = {
  master: "Master Data",
  transaksi: "Transaksi & Log Produksi",
  qc_approval: "Quality Control & Approval",
  sosial: "Papan Info & Chat",
};

type KeyMode = "natural" | "id";

interface TableDef {
  /** Nama model Prisma (PascalCase) -- juga dipakai sbg nama sheet Excel. */
  model: string;
  category: AdvancedCategory;
  keyMode: KeyMode;
  /** Wajib diisi kalau keyMode === "natural". */
  naturalKey?: string;
}

/** Urutan di dalam tiap kategori SENGAJA parent dulu baru child (mis.
 * MillingLog sebelum MillingAttachment) -- pada saat import, FK
 * (mis. `logId`) baru valid kalau baris induknya sudah lebih dulu ditulis
 * dalam transaksi yang sama. */
const TABLE_REGISTRY: TableDef[] = [
  // Master Data -- upsert by natural unique key, SAMA POLA dgn Import CSV/Excel
  // per-tabel yang sudah ada di masterdata.routes.ts (bukan by id).
  { model: "MasterOrder", category: "master", keyMode: "natural", naturalKey: "order" },
  { model: "MasterTank", category: "master", keyMode: "natural", naturalKey: "code" },
  { model: "MasterMesin", category: "master", keyMode: "natural", naturalKey: "code" },
  { model: "MaterialFlow", category: "master", keyMode: "natural", naturalKey: "materialNumber" },
  { model: "MasterEmployee", category: "master", keyMode: "natural", naturalKey: "employeeId" },

  // Transaksi & Log Produksi
  { model: "MillingLog", category: "transaksi", keyMode: "id" },
  { model: "MillingAttachment", category: "transaksi", keyMode: "id" },
  { model: "PremixAftermixLog", category: "transaksi", keyMode: "id" },
  { model: "PremixAftermixAttachment", category: "transaksi", keyMode: "id" },
  { model: "ColourMatchingLog", category: "transaksi", keyMode: "id" },
  { model: "ColourMatchingAttachment", category: "transaksi", keyMode: "id" },
  { model: "BongkaranLog", category: "transaksi", keyMode: "id" },
  { model: "BongkaranAttachment", category: "transaksi", keyMode: "id" },
  { model: "MaintenanceLog", category: "transaksi", keyMode: "id" },
  { model: "MaintenanceAttachment", category: "transaksi", keyMode: "id" },
  { model: "PackingLog", category: "transaksi", keyMode: "id" },
  { model: "PackingAttachment", category: "transaksi", keyMode: "id" },
  { model: "PwoSchedule", category: "transaksi", keyMode: "id" },
  { model: "TankManualInput", category: "transaksi", keyMode: "id" },
  { model: "ProductionOrderManualInput", category: "transaksi", keyMode: "id" },
  { model: "ProductionLabel", category: "transaksi", keyMode: "id" },
  { model: "ProductionLabelFg", category: "transaksi", keyMode: "id" },

  // Quality Control & Approval
  { model: "ProductSpec", category: "qc_approval", keyMode: "id" },
  { model: "ProductSpecParameter", category: "qc_approval", keyMode: "id" },
  { model: "CheckResult", category: "qc_approval", keyMode: "id" },
  { model: "CheckResultParameter", category: "qc_approval", keyMode: "id" },
  { model: "IcrAppearanceFile", category: "qc_approval", keyMode: "id" },
  { model: "ApprovalSchedule", category: "qc_approval", keyMode: "id" },
  { model: "ApprovalAttachment", category: "qc_approval", keyMode: "id" },
  { model: "AdminQc", category: "qc_approval", keyMode: "id" },
  { model: "AdminQcAttachment", category: "qc_approval", keyMode: "id" },

  // Papan Info & Chat
  { model: "Post", category: "sosial", keyMode: "id" },
  { model: "PostAttachment", category: "sosial", keyMode: "id" },
  { model: "PostComment", category: "sosial", keyMode: "id" },
  { model: "PostLike", category: "sosial", keyMode: "id" },
  { model: "Message", category: "sosial", keyMode: "id" },
];

interface FieldMeta {
  name: string;
  type: string; // "String" | "Int" | "Boolean" | "DateTime" | "Json" | enum name | ...
  kind: "scalar" | "enum";
  isId: boolean;
  isList: boolean;
}

const dmmfModelCache = new Map<string, { dbName: string; fields: FieldMeta[] }>();

function getModelMeta(modelName: string): { dbName: string; fields: FieldMeta[] } {
  const cached = dmmfModelCache.get(modelName);
  if (cached) return cached;
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) throw new Error(`Model Prisma "${modelName}" tidak ditemukan.`);
  const fields: FieldMeta[] = model.fields
    .filter((f) => f.kind !== "object")
    .map((f) => ({ name: f.name, type: f.type, kind: f.kind as "scalar" | "enum", isId: !!f.isId, isList: !!f.isList }));
  const meta = { dbName: model.dbName ?? modelName, fields };
  dmmfModelCache.set(modelName, meta);
  return meta;
}

function delegateName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function delegate(modelName: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any)[delegateName(modelName)];
}

function tableDef(modelName: string): TableDef {
  const def = TABLE_REGISTRY.find((t) => t.model === modelName);
  if (!def) throw new Error(`Tabel "${modelName}" tidak terdaftar di fitur Import/Export Advance.`);
  return def;
}

export function tablesForCategories(categories: AdvancedCategory[]): TableDef[] {
  return TABLE_REGISTRY.filter((t) => categories.includes(t.category));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function cellFromValue(value: unknown, field: FieldMeta): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (field.isList) return JSON.stringify(value);
  switch (field.type) {
    case "DateTime":
      return value instanceof Date ? value : new Date(value as string);
    case "Json":
      return JSON.stringify(value);
    case "Boolean":
      return Boolean(value);
    case "Int":
      return Number(value);
    default:
      return String(value);
  }
}

export interface ExportResult {
  tableCounts: { model: string; label: string; rows: number }[];
}

const EXPORT_PAGE_SIZE = 5000;

/** Export SELALU streaming (langsung ke response stream, per-baris/per-halaman
 * DB) -- TIDAK PERNAH menampung seluruh isi tabel di memori JS sekaligus.
 * DITEMUKAN via SIT (2026-09-09): `findMany()` tanpa batas + ExcelJS non-
 * streaming pada MasterOrder (ratusan ribu baris, sinkron dari SAP-COOISPI)
 * bikin proses Node crash "JavaScript heap out of memory". Cursor pagination
 * by primary key (bukan OFFSET/skip) supaya tetap cepat walau di baris ke-
 * ratusan-ribu sekalipun. */
export async function streamExportWorkbook(res: Response, categories: AdvancedCategory[], exportedByName: string): Promise<ExportResult> {
  const tables = tablesForCategories(categories);
  if (tables.length === 0) throw new HttpError(400, "Pilih minimal 1 kategori data untuk di-export.");

  // count() dulu (query agregat murah, tidak menarik baris) supaya sheet
  // _MetaInfo bisa ditulis PALING AWAL (streaming writer tidak bisa
  // menyisipkan/memindah sheet setelah baris lain sudah dikirim ke stream).
  const tableCounts = await Promise.all(
    tables.map(async (def) => ({ model: def.model, label: def.model, rows: await delegate(def.model).count() }))
  );

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  workbook.creator = "NPI Website App -- Import & Export Data (Advance)";
  workbook.created = new Date();

  const metaSheet = workbook.addWorksheet("_MetaInfo");
  metaSheet.columns = [
    { header: "Key", key: "k", width: 24 },
    { header: "Value", key: "v", width: 60 },
  ];
  metaSheet.getRow(1).font = { bold: true };
  metaSheet.addRow({ k: "Aplikasi", v: "NPI Website App -- Import & Export Data (Advance)" }).commit();
  metaSheet.addRow({ k: "Diexport pada", v: new Date().toISOString() }).commit();
  metaSheet.addRow({ k: "Diexport oleh", v: exportedByName }).commit();
  metaSheet.addRow({ k: "Kategori", v: categories.map((c) => CATEGORY_LABELS[c]).join(", ") }).commit();
  metaSheet.addRow({ k: "", v: "" }).commit();
  metaSheet.addRow({ k: "Tabel", v: "Jumlah Baris" }).commit();
  for (const tc of tableCounts) metaSheet.addRow({ k: tc.model, v: tc.rows }).commit();
  metaSheet.commit();

  for (const def of tables) {
    const meta = getModelMeta(def.model);
    const idField = meta.fields.find((f) => f.isId)!;
    const sheet = workbook.addWorksheet(def.model.slice(0, 31));
    sheet.columns = meta.fields.map((f) => ({ header: f.name, key: f.name, width: 20 }));
    sheet.getRow(1).font = { bold: true };

    let cursor: unknown = undefined;
    for (;;) {
      const page: Record<string, unknown>[] = await delegate(def.model).findMany({
        take: EXPORT_PAGE_SIZE,
        orderBy: { [idField.name]: "asc" },
        ...(cursor !== undefined ? { cursor: { [idField.name]: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      for (const row of page) {
        const rowValues: Record<string, ExcelJS.CellValue> = {};
        for (const f of meta.fields) rowValues[f.name] = cellFromValue(row[f.name], f);
        sheet.addRow(rowValues).commit();
      }
      cursor = page[page.length - 1][idField.name];
      if (page.length < EXPORT_PAGE_SIZE) break;
    }
    sheet.commit();
  }

  await workbook.commit();
  return { tableCounts };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function valueFromCell(cellValue: ExcelJS.CellValue, field: FieldMeta): unknown {
  if (cellValue === null || cellValue === undefined || cellValue === "") return field.isId ? undefined : null;

  if (field.isList) {
    if (typeof cellValue === "string") {
      try {
        const parsed = JSON.parse(cellValue);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return cellValue
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return [];
  }

  switch (field.type) {
    case "DateTime": {
      if (cellValue instanceof Date) return cellValue;
      if (typeof cellValue === "object" && cellValue && "result" in (cellValue as object)) {
        // formula cell hasil evaluasi
        return valueFromCell((cellValue as ExcelJS.CellFormulaValue).result ?? null, field);
      }
      const d = new Date(String(cellValue));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case "Json": {
      if (typeof cellValue !== "string") return cellValue;
      try {
        return JSON.parse(cellValue);
      } catch {
        return null;
      }
    }
    case "Boolean": {
      if (typeof cellValue === "boolean") return cellValue;
      const s = String(cellValue).trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes";
    }
    case "Int": {
      const n = Number(cellValue);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    default:
      return String(cellValue);
  }
}

export interface ParsedSheet {
  model: string;
  def: TableDef;
  rows: Record<string, unknown>[];
}

const REQUIRED_META_SHEET = "_MetaInfo";

/** Batas ukuran file utk IMPORT (BEDA dari batas upload umum di env.maxImportMb)
 * -- DITEMUKAN via SIT (2026-09-09): ExcelJS.stream.xlsx.WorkbookReader
 * (streaming) TERNYATA punya bug internal ("Cannot read properties of
 * undefined (reading 'sheets')", lihat exceljs lib/stream/xlsx/workbook-reader.js)
 * saat membaca file yang ditulis oleh writer LAIN drpd streaming writer-nya
 * sendiri -- termasuk kemungkinan file yang diedit ulang & disimpan oleh
 * Microsoft Excel asli (skenario UTAMA fitur ini: "export, edit manual,
 * import balik"). Jadi baca file TETAP pakai `workbook.xlsx.load()` biasa
 * (kompatibel dgn writer/aplikasi Excel apa pun) TAPI DIBATASI ukurannya --
 * `.load()` sendiri crash ("Invalid string length" dari JSZip) pada file
 * >~50-80MB (Export kategori Master Data penuh, ~650rb baris, terbukti
 * crash). Kalau perlu resync SELURUH Master Data (bukan hasil edit), pakai
 * Import CSV/Excel per-tabel yang sudah ada (menu Master Data), BUKAN fitur
 * ini -- fitur ini utk data yang diedit/dipilih manual, bukan bulk resync. */
const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024; // 30 MB

export async function parseImportWorkbook(buffer: Buffer): Promise<ParsedSheet[]> {
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw new HttpError(
      400,
      `File terlalu besar untuk Import Data (Advance) (${(buffer.length / 1024 / 1024).toFixed(1)} MB, maks ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB). ` +
        `Ini biasanya terjadi kalau kategori "Master Data" di-export & mau di-import ulang UTUH (didominasi ratusan ribu baris Referensi Order/PO) -- ` +
        `fitur ini ditujukan utk data yang sudah diedit/dipilih manual, bukan resync massal. Untuk resync massal Referensi Order/PO, ` +
        `pakai menu Master Data > Import CSV/Excel yang memang dibuat utk volume besar.`
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  if (!workbook.getWorksheet(REQUIRED_META_SHEET)) {
    throw new HttpError(
      400,
      'File tidak dikenali sebagai hasil Export Data (Advance) -- sheet "_MetaInfo" tidak ditemukan. Gunakan file hasil Export dari menu ini.'
    );
  }

  const parsed: ParsedSheet[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.name === REQUIRED_META_SHEET) continue;
    const modelName = TABLE_REGISTRY.find((t) => t.model === sheet.name)?.model;
    if (!modelName) continue; // sheet tak dikenal -- diabaikan, bukan error keras
    const def = tableDef(modelName);
    const meta = getModelMeta(modelName);

    const headerRow = sheet.getRow(1);
    const colIndexByField = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const name = String(cell.value ?? "").trim();
      if (name) colIndexByField.set(name, colNumber);
    });

    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const isEmpty = row.cellCount === 0 || row.values === undefined;
      if (isEmpty) return;
      const record: Record<string, unknown> = {};
      let hasAnyValue = false;
      for (const f of meta.fields) {
        const colIdx = colIndexByField.get(f.name);
        const raw = colIdx ? row.getCell(colIdx).value : null;
        if (raw !== null && raw !== undefined && raw !== "") hasAnyValue = true;
        record[f.name] = valueFromCell(raw ?? null, f);
      }
      if (hasAnyValue) rows.push(record);
    });

    parsed.push({ model: modelName, def, rows });
  }

  // Urutkan sesuai TABLE_REGISTRY (parent dulu) supaya FK selalu aman saat commit.
  parsed.sort((a, b) => TABLE_REGISTRY.findIndex((t) => t.model === a.model) - TABLE_REGISTRY.findIndex((t) => t.model === b.model));
  return parsed;
}

export interface TablePreview {
  model: string;
  category: AdvancedCategory;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  errors: string[];
}

export async function previewImport(sheets: ParsedSheet[]): Promise<TablePreview[]> {
  const result: TablePreview[] = [];
  for (const sheet of sheets) {
    const meta = getModelMeta(sheet.model);
    const idField = meta.fields.find((f) => f.isId)!;
    const errors: string[] = [];
    let toCreate = 0;
    let toUpdate = 0;

    for (const [idx, row] of sheet.rows.entries()) {
      const rowLabel = `baris ${idx + 2}`;
      try {
        if (sheet.def.keyMode === "natural") {
          const keyVal = row[sheet.def.naturalKey!];
          if (!keyVal) {
            errors.push(`${rowLabel}: kolom "${sheet.def.naturalKey}" kosong, wajib diisi.`);
            continue;
          }
          const existing = await delegate(sheet.model).findUnique({ where: { [sheet.def.naturalKey!]: keyVal } });
          existing ? toUpdate++ : toCreate++;
        } else {
          const keyVal = row[idField.name];
          if (keyVal === undefined || keyVal === null) {
            toCreate++;
            continue;
          }
          const existing = await delegate(sheet.model).findUnique({ where: { [idField.name]: keyVal } });
          existing ? toUpdate++ : toCreate++;
        }
      } catch (err) {
        errors.push(`${rowLabel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    result.push({ model: sheet.model, category: sheet.def.category, totalRows: sheet.rows.length, toCreate, toUpdate, errors });
  }
  return result;
}

export interface CommitResult {
  model: string;
  created: number;
  updated: number;
  failed: { row: number; message: string }[];
}

async function resyncIntSequence(modelName: string): Promise<void> {
  const meta = getModelMeta(modelName);
  const idField = meta.fields.find((f) => f.isId);
  if (!idField || idField.type !== "Int") return;
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${meta.dbName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${meta.dbName}"), 1))`
  );
}

/** Jalankan import SESUNGGUHNYA -- upsert per baris, per tabel, dalam urutan
 * TABLE_REGISTRY (parent dulu). Best-effort per baris: 1 baris gagal (mis.
 * kolom wajib kosong) TIDAK menggagalkan seluruh proses, tapi dicatat di
 * `failed` supaya kelihatan jelas baris mana yang perlu dibetulkan manual --
 * lebih aman drpd 1 baris rusak bikin sisa ratusan baris lain batal semua,
 * MENGINGAT selalu ada snapshot pg_dump pre-import sbg jaring pengaman kalau
 * hasil akhirnya ternyata perlu dibatalkan total (lihat backup.routes.ts). */
export async function commitImport(sheets: ParsedSheet[]): Promise<CommitResult[]> {
  const results: CommitResult[] = [];

  for (const sheet of sheets) {
    const meta = getModelMeta(sheet.model);
    const idField = meta.fields.find((f) => f.isId)!;
    const failed: { row: number; message: string }[] = [];
    let created = 0;
    let updated = 0;

    for (const [idx, row] of sheet.rows.entries()) {
      try {
        if (sheet.def.keyMode === "natural") {
          const key = sheet.def.naturalKey!;
          const keyVal = row[key];
          if (!keyVal) throw new Error(`kolom "${key}" kosong`);
          const data = { ...row };
          delete data[idField.name];
          const existing = await delegate(sheet.model).findUnique({ where: { [key]: keyVal } });
          await delegate(sheet.model).upsert({ where: { [key]: keyVal }, create: data, update: data });
          existing ? updated++ : created++;
        } else {
          const keyVal = row[idField.name];
          const data = { ...row };
          if (keyVal === undefined || keyVal === null) {
            delete data[idField.name];
            await delegate(sheet.model).create({ data });
            created++;
          } else {
            const existing = await delegate(sheet.model).findUnique({ where: { [idField.name]: keyVal } });
            await delegate(sheet.model).upsert({ where: { [idField.name]: keyVal }, create: data, update: data });
            existing ? updated++ : created++;
          }
        }
      } catch (err) {
        failed.push({ row: idx + 2, message: err instanceof Error ? err.message : String(err) });
      }
    }

    if (sheet.def.keyMode === "id") await resyncIntSequence(sheet.model);
    results.push({ model: sheet.model, created, updated, failed });
  }

  return results;
}

export function categoryTableSummary(): { category: AdvancedCategory; label: string; tables: string[] }[] {
  const cats = Array.from(new Set(TABLE_REGISTRY.map((t) => t.category)));
  return cats.map((c) => ({ category: c, label: CATEGORY_LABELS[c], tables: TABLE_REGISTRY.filter((t) => t.category === c).map((t) => t.model) }));
}
