import { readFileSync } from "fs";
import { parse as parseCsv } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";

/** One-off import (2026-07-30): "Approval — Lot History" export dari user
 * (C:\Users\abdad\Downloads\approval-lot-history.csv, TSV walau ekstensinya
 * .csv, hasil Export CSV dari tabel History Approval itu sendiri) --
 * dimasukkan balik ke tabel ApprovalSchedule via Prisma langsung (BUKAN lewat
 * POST /approvals) supaya bisa melewati validasi Zod yg mewajibkan IU
 * Plant/Code Tanki terisi -- banyak baris historis di file ini kosong utk
 * kedua kolom itu, sesuai keputusan eksplisit user: tetap diimpor apa adanya.
 * "Status"/"Processing Time"/"Lampiran"/"Aksi" DIABAIKAN (kolom turunan,
 * bukan data tersimpan). "Input By" di file kosong semua -- diisi NIK user
 * yg menjalankan import ini (bukan lewat form, jadi tidak ada NIK asli utk
 * dipertahankan).
 *
 * Jalankan dgn: npx tsx scripts/import-approval-lot-history.ts --dry-run
 * (cek hasil parse dulu TANPA nulis ke DB), lalu tanpa --dry-run utk beneran
 * insert.
 */

const FILE_PATH = "C:\\Users\\abdad\\Downloads\\approval-lot-history.csv";
const IMPORTED_BY_NIK = "000001";

const prisma = new PrismaClient();

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "D-Mon-YY" atau "DD-Mon-YY", mis. "4-Sep-25", "17-Sep-25" -> Date (asumsi 20xx). */
function parseShortDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  const year = 2000 + Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "M/D/YYYY HH:mm", mis. "7/23/2026 20:29" -> Date. */
function parseTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, mo, da, yr, hh, mm] = m;
  const d = new Date(Date.UTC(Number(yr), Number(mo) - 1, Number(da), Number(hh), Number(mm)));
  return Number.isNaN(d.getTime()) ? null : d;
}

function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

interface ParsedRow {
  timestamp: Date;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  mrpPic: string | null;
  salesPic: string | null;
  prepareProduksi: Date | null;
  sprayMan: string | null;
  wetSample: string | null;
  panel: string | null;
  lotCoa: Date | null;
  sendToTech: Date | null;
  technicalDateReceiving: Date | null;
  submitToCustomer: Date | null;
  customer: string | null;
  custSegmen: string | null;
  techName: string | null;
  finishApp: Date | null;
  remark: string | null;
  inputBy: string;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");

  const content = readFileSync(FILE_PATH, "utf8");
  const records = parseCsv(content, {
    delimiter: "\t",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  console.log(`Total baris ter-parse: ${records.length}`);

  const parsed: ParsedRow[] = [];
  const skipped: { line: number; reason: string; raw: Record<string, string> }[] = [];

  records.forEach((r, idx) => {
    const order = str(r["Order"]);
    if (!order) {
      skipped.push({ line: idx + 2, reason: "Order kosong", raw: r });
      return;
    }
    const timestamp = parseTimestamp(r["Timestamp"] ?? "") ?? new Date();
    parsed.push({
      timestamp,
      order,
      materialNumber: str(r["Material Number"]),
      materialDescription: str(r["Material Description"]),
      batch: str(r["Batch"]),
      orderQty: str(r["Order Qty"]),
      plant: str(r["Plant"]),
      iuPlant: str(r["IU Plant"]),
      codeTanki: str(r["Code Tanki"]),
      mrpPic: str(r["Mrp Pic"]),
      salesPic: str(r["Sales Pic"]),
      prepareProduksi: parseShortDate(r["Prepare Date"] ?? ""),
      sprayMan: str(r["Spray Man"]),
      wetSample: str(r["Wet Sample"]),
      panel: str(r["Panel"]),
      lotCoa: parseShortDate(r["Lot COA"] ?? ""),
      sendToTech: parseShortDate(r["Send To Tech"] ?? ""),
      technicalDateReceiving: parseShortDate(r["Submit Tech"] ?? ""),
      submitToCustomer: parseShortDate(r["Submit Cust"] ?? ""),
      customer: str(r["Customer"]),
      custSegmen: str(r["Cust Segmen"]),
      techName: str(r["Tech Name"]),
      finishApp: parseShortDate(r["Finish App"] ?? ""),
      remark: str(r["Remark"]),
      inputBy: IMPORTED_BY_NIK,
    });
  });

  console.log(`Baris valid (Order terisi): ${parsed.length}`);
  console.log(`Baris dilewati: ${skipped.length}`);
  if (skipped.length > 0) {
    console.log("Contoh baris yg dilewati (maks 5):");
    skipped.slice(0, 5).forEach((s) => console.log(`  Baris ~${s.line}: ${s.reason} -- ${JSON.stringify(s.raw)}`));
  }

  const missingIuPlant = parsed.filter((p) => !p.iuPlant).length;
  const missingCodeTanki = parsed.filter((p) => !p.codeTanki).length;
  console.log(`Baris tanpa IU Plant: ${missingIuPlant}`);
  console.log(`Baris tanpa Code Tanki: ${missingCodeTanki}`);

  console.log("\nContoh 3 baris pertama hasil parse:");
  parsed.slice(0, 3).forEach((p, i) => console.log(`${i + 1}.`, JSON.stringify(p, null, 2)));

  console.log("\nContoh 3 baris TERAKHIR hasil parse:");
  parsed.slice(-3).forEach((p, i) => console.log(`${i + 1}.`, JSON.stringify(p, null, 2)));

  if (dryRun) {
    console.log("\n--dry-run aktif -- TIDAK ada yg ditulis ke database.");
    return Promise.resolve();
  }

  console.log(`\nMenulis ${parsed.length} baris ke ApprovalSchedule...`);
  return prisma.approvalSchedule.createMany({ data: parsed }).then((res) => {
    console.log(`Selesai. ${res.count} baris berhasil disimpan.`);
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
