import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth } from "../../middleware/auth";
import { evaluateSpec } from "../../lib/specEval";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

interface ProductionOrderRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  process: string;
  start: Date | null;
  finish: Date | null;
  remark: string | null;
  timestamp: Date;
  leadTimeProses: number;
  stages: { name: string; done: boolean }[];
  progressPercent: number;
  /** Label Proses Packing utk Order ini, TERPISAH dari kolom "Proses" --
   * sesuai instruksi eksplisit user (2026-07-28): kolom "Proses" cuma boleh
   * diisi Premix/Milling/Aftermix/Colour Matching/QC/Approval, Packing tidak
   * boleh lagi jadi kandidat "paling akhir" utk kolom itu. Lihat
   * latestPackingLabelByOrder. */
  productionActions: string | null;
}

/**
 * Urutan tahapan lengkap 1 Order (di luar Queue/Done -- itu cuma state
 * awal/akhir, bukan tahap kerja): Premix, Milling, Aftermix, Colour Matching,
 * QC, Approval, Packing -- sesuai urutan yang dikonfirmasi user. Dipakai utk
 * kolom "Proses Bar": tahap yg DITAMPILKAN (label) = tahap yg pernah ada
 * histori Material Number Order ybs, LINTAS Order/Batch manapun (lihat
 * computeStages) -- tapi tahap mana yg "done" (berwarna) tetap dicek dari
 * Order ybs SENDIRI, TIDAK menuntut "Finish" dulu. Persentase = jumlah tahap
 * done dibagi jumlah tahap yg relevan utk Material Number itu (BUKAN selalu
 * dibagi 7) -- ini menjawab "dari seluruh rangkaian proses Material ini,
 * Order ybs sudah sampai mana", bukan "proses mana yg sudah 100% selesai
 * detailnya".
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tanggal-saja (jam dinolkan) menurut kalender WIB (UTC+7) -- dipakai supaya
 * hitungan hari kerja konsisten terlepas dari timezone OS server-nya. */
function toWibDateOnly(d: Date): Date {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

/**
 * "Lead Time Proses": jumlah HARI KERJA (Senin-Jumat, Sabtu/Minggu TIDAK
 * dihitung) sejak Order ini PERTAMA KALI muncul di sistem (baris tercepat di
 * modul manapun -- Premix/Aftermix/Milling/Colour Matching/Packing/QC)
 * sampai hari ini. Hari Order itu sendiri dibuat belum dihitung (baru mulai
 * berjalan besoknya) -- kalau baru dibuat hari ini, Lead Time = 0.
 */
function countBusinessDaysElapsed(from: Date, to: Date): number {
  const start = toWibDateOnly(from);
  const end = toWibDateOnly(to);
  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getUTCDay(); // 0 = Minggu, 6 = Sabtu
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

interface ColourMatchingStageFields {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
}

/**
 * Label Proses granular Colour Matching -- DISEDERHANAKAN TOTAL 2026-07-29
 * sesuai instruksi eksplisit user, menggantikan versi 2026-07-26 yg juga
 * mensyaratkan IU Plant/Member/Form per Man terisi. SEKARANG murni dari
 * kolom Form Received/Start/Finish saja (3 state, sama pola dgn Approval/
 * Packing yg sudah disederhanakan lebih dulu):
 * - Form Received terisi -> "QU - Colour Matching".
 * - Form Received + Start terisi -> "Colour Matching".
 * - Form Received + Start + Finish terisi -> "Colour Matching - DN".
 */
function colourMatchingProcessLabel(r: ColourMatchingStageFields): string {
  if (r.finish && r.start && r.formReceived) return "Colour Matching - DN";
  if (r.start && r.formReceived) return "Colour Matching";
  if (r.formReceived) return "QU - Colour Matching";
  return "-";
}

interface PremixStageFields {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
}

/**
 * Label Proses granular PREMIX -- DISEDERHANAKAN TOTAL 2026-07-30 sesuai
 * instruksi eksplisit user, menggantikan versi lama yg jg mensyaratkan
 * Leader/Member/Qty per Man terisi (dulu fungsi ini SAMA PERSIS dipakai jg
 * utk AFTERMIX, tapi Aftermix sudah disederhanakan lebih dulu 2026-07-29,
 * lihat aftermixProcessLabel). SEKARANG murni dari kolom Form Received/
 * Start/Finish saja (3 state, pola sama dgn Approval/Packing/Colour
 * Matching/Aftermix/Milling yg sudah disederhanakan lebih dulu):
 * - Form Received terisi -> "QU - Premix".
 * - Form Received + Start terisi -> "Premix".
 * - Form Received + Start + Finish terisi -> "Premix - DN".
 */
function premixProcessLabel(r: PremixStageFields): string {
  if (r.finish && r.start && r.formReceived) return "Premix - DN";
  if (r.start && r.formReceived) return "Premix";
  if (r.formReceived) return "QU - Premix";
  return "-";
}

/**
 * Label Proses granular AFTERMIX -- DISEDERHANAKAN TOTAL 2026-07-29 sesuai
 * instruksi eksplisit user, menggantikan versi lama yg berbagi logika dgn
 * Premix (jg mensyaratkan Leader/Member/Qty per Man terisi). SEKARANG murni
 * dari kolom Form Received/Start/Finish saja (3 state, pola sama dgn
 * Approval/Packing/Colour Matching yg sudah disederhanakan lebih dulu):
 * - Form Received terisi -> "QU - Aftermix".
 * - Form Received + Start terisi -> "Aftermix".
 * - Form Received + Start + Finish terisi -> "Aftermix - DN".
 */
function aftermixProcessLabel(r: { formReceived: Date | null; start: Date | null; finish: Date | null }): string {
  if (r.finish && r.start && r.formReceived) return "Aftermix - DN";
  if (r.start && r.formReceived) return "Aftermix";
  if (r.formReceived) return "QU - Aftermix";
  return "-";
}

interface MillingStageFields {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
}

/**
 * Label Proses granular Milling -- DISEDERHANAKAN TOTAL 2026-07-29 sesuai
 * instruksi eksplisit user, menggantikan versi 2026-07-26 yg jg mensyaratkan
 * Leader/Code Tanki 1/Code Mesin/Member/Qty Act/Fineness/Visco/Suhu terisi.
 * SEKARANG murni dari kolom Form Received/Start/Finish saja (3 state, pola
 * sama dgn Approval/Packing/Colour Matching/Aftermix yg sudah disederhanakan
 * lebih dulu):
 * - Form Received terisi -> "QU - Milling".
 * - Form Received + Start terisi -> "Milling".
 * - Form Received + Start + Finish terisi -> "Milling - DN".
 */
function millingProcessLabel(r: MillingStageFields): string {
  if (r.finish && r.start && r.formReceived) return "Milling - DN";
  if (r.start && r.formReceived) return "Milling";
  if (r.formReceived) return "QU - Milling";
  return "-";
}

interface PackingStageFields {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  spvName: string | null;
  leaderName: string | null;
  totalQty: string | null;
  qtyPerMan: string | null;
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
  remark: string | null;
}

/**
 * "Input paling terakhir" utk SEMUA modul (Premix/Aftermix, Milling, Colour
 * Matching, Packing) ditentukan dari kolom Finish/Start log itu sendiri --
 * BUKAN dari timestamp Save. Finish dipakai duluan kalau sudah diisi (proses
 * sudah selesai), fallback ke Start kalau baru mulai (mis. Colour Matching
 * yang belum Finish), timestamp Save cuma jaga-jaga kalau keduanya kosong.
 */
function latestMoment(start: Date | null, finish: Date | null, fallbackTimestamp: Date): Date {
  return finish ?? start ?? fallbackTimestamp;
}

/**
 * Baris PackingLog PALING TERAKHIR per Order (dedupe by latestMoment) --
 * dipakai BERSAMA oleh latestPackingLabelByOrder (kolom "Production Actions")
 * DAN override Start Proses/Finish Proses/Remark di /production-orders
 * (2026-07-29, instruksi eksplisit user: begitu Order ybs py baris PackingLog
 * beneran, 3 kolom itu ambil dari History Packing, BUKAN lagi dari
 * Premix/Milling/Aftermix/Colour Matching/Approval spt biasanya).
 */
function latestPackingRowByOrder(rows: (PackingStageFields & { timestamp: Date })[]): Map<string, PackingStageFields> {
  const latestByOrder = new Map<string, { moment: Date; row: PackingStageFields }>();
  for (const r of rows) {
    const moment = latestMoment(r.start, r.finish, r.timestamp);
    const existing = latestByOrder.get(r.order);
    if (!existing || moment.getTime() > existing.moment.getTime()) latestByOrder.set(r.order, { moment, row: r });
  }
  const result = new Map<string, PackingStageFields>();
  for (const [order, { row }] of latestByOrder) result.set(order, row);
  return result;
}

/**
 * Label Packing PALING TERAKHIR per Order -- dipakai utk kolom terpisah
 * "Production Actions" di Dashboard Production Order Monitoring & Tank
 * Monitoring. Skema granular lama (QU-PC/Packing/Done, berbasis Form
 * Received/Start/Finish/Qty per Man) sempat diganti "Packing"/"Packing - DN"
 * (2026-07-29), lalu DIREVISI LAGI hari yg sama sesuai instruksi eksplisit
 * user: label DN-nya sekarang "Done" (bukan "Packing - DN"), warnanya ikut
 * pakai warna "Done" (hijau tua) -- BEDA dari Approval yg tetap "Approval -
 * DN" warna Approval sendiri, jadi TIDAK pakai finishBasedLabel di sini.
 * "QU - Packing" (Order yg qcPassed-nya sudah terisi tapi belum py baris
 * PackingLog sama sekali) DITAMBAHKAN terpisah oleh pemanggil (lihat
 * queuePackingOrders) krn fungsi ini cuma bisa lihat Order yg SUDAH py baris
 * PackingLog.
 */
function latestPackingLabelByOrder(latestPackingRow: Map<string, PackingStageFields>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [order, row] of latestPackingRow) labels.set(order, row.finish ? "Done" : "Packing");
  return labels;
}

interface QcParam {
  parameter: string;
  standard: string | null;
  result: string | null;
  start: Date | null;
  finish: Date | null;
}

/**
 * Item Check yang mewakili 1 Order QC di dashboard (yg SENGAJA cuma 1 baris
 * per Order) -- BUKAN Item Check pertama (No 1), tapi yang Start-nya PALING
 * UPDATE. Kalau beberapa Item Check di-input dalam waktu yang sama (Start
 * sama persis, mis. di-save bareng dalam 1x Save Check Results), yang dipakai
 * adalah yang paling BAWAH (No terbesar di antara yang Start-nya sama) --
 * bukan yang paling atas. Item Check yang Start-nya masih kosong dianggap
 * belum benar-benar "terinput" dan diabaikan, kecuali belum ada satupun Item
 * Check yang Start-nya terisi (fallback ke Item Check pertama apa adanya).
 */
function qcRepresentativeParam(params: QcParam[]): QcParam | undefined {
  const withStart = params.filter((p) => p.start != null);
  if (withStart.length === 0) return params[0];
  // params diurutkan "no" ASC (dari query) -- pakai `>=` supaya kalau ada
  // beberapa Start yang sama persis, yang paling BAWAH (no terbesar) menang.
  return withStart.reduce((latest, p) => (p.start!.getTime() >= latest.start!.getTime() ? p : latest), withStart[0]);
}

/**
 * Label Proses utk QC (Input Check Results) -- format "QC : <Item Check> :
 * <Verdict>", diwakili Item Check hasil qcRepresentativeParam (lihat di atas).
 */
function qcProcessLabel(param: QcParam | undefined): string {
  if (!param) return "QC";
  const verdict = evaluateSpec(param.standard, param.result);
  const verdictLabel = verdict === "unknown" ? "-" : verdict.charAt(0).toUpperCase() + verdict.slice(1);
  return `QC : ${param.parameter} : ${verdictLabel}`;
}

/**
 * Label "Proses" utk Approval -- direvisi TOTAL 2026-07-29 sesuai instruksi
 * eksplisit user, menggantikan skema granular lama (berbasis Admin QC
 * Stage/Prepare Date/dst). Cuma 3 state, PERSIS mengikuti keberadaan Order
 * di tab menu Approval:
 * 1) "List Antrian Approval" (lihat GET /approvals/queue) -- Order BELUM py
 *    baris di ApprovalSchedule, tapi Admin QC Stage-nya sudah Approval/Joint
 *    Lot -- label "QU - Approval".
 * 2) Order SUDAH py baris di ApprovalSchedule ("Lot History") tapi Finish
 *    App belum terisi -- label "Approval".
 * 3) Sama spt di atas TAPI Finish App SUDAH terisi -- label "Approval - DN".
 * Packing PAKAI skema serupa (lihat latestPackingLabelByOrder) tapi label DN-
 * nya "Done" (bukan "Packing - DN") dan warnanya beda (hijau tua, bukan
 * hijau Packing) -- makanya Packing TIDAK pakai fungsi generik ini lagi
 * (direvisi 2026-07-29, instruksi eksplisit user yg kedua kalinya).
 */
function finishBasedLabel(stageName: "Approval", finish: Date | null): string {
  return finish ? `${stageName} - DN` : stageName;
}

/**
 * Status Order terkini lintas modul produksi (Premix, Aftermix, Milling,
 * Colour Matching, Packing) -- acuannya nomor Order, dipakai oleh Dashboard
 * "Production Order Monitoring". Approval & Check Results belum diikutkan
 * karena tidak punya pasangan Start/Finish yang sama bentuknya.
 *
 * Per Order HANYA ditampilkan 1 baris: hasil inputan PALING TERAKHIR, lintas
 * semua modul -- bukan seluruh riwayat/history-nya. "Paling terakhir" DIHITUNG
 * dari kolom Finish/Start log itu sendiri (lihat latestMoment), BUKAN dari
 * timestamp Save -- supaya urutannya sesuai kapan prosesnya benar-benar
 * dikerjakan, bukan kapan formnya di-submit.
 *
 * Material Number/Material Description/Batch SENGAJA tidak diambil dari
 * snapshot History tiap modul (bisa basi kalau Master Data Cooispi diedit
 * belakangan) -- selalu di-lookup ulang dari MasterOrder (Master Data
 * Cooispi) berdasarkan nomor Order, supaya selalu data terbaru. History
 * cuma jadi acuan nomor Order + info prosesnya (Start/Finish/Remark).
 */
dashboardRouter.get(
  "/production-orders",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();

    // Query TIDAK difilter `search` di sini lagi -- histori LINTAS ORDER (utk
    // Set per Material Number di bawah) harus tetap lengkap walau user lagi
    // nyari 1 Order spesifik, supaya tahu SELURUH tahap yg pernah dikerjakan
    // utk Material Number Order itu, bukan cuma yg match teks pencarian.
    // Filter `search` dipindah ke Array.filter di `result` paling akhir.
    const [premixAftermix, milling, colourMatching, packing, checkResults, approvals] = await Promise.all([
      prisma.premixAftermixLog.findMany({
        select: {
          order: true,
          orderQty: true,
          section: true,
          materialNumber: true,
          formReceived: true,
          start: true,
          finish: true,
          leader: true,
          qtyPerMan: true,
          members: true,
          remark: true,
          timestamp: true,
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
      prisma.millingLog.findMany({
        select: {
          order: true,
          orderQty: true,
          materialNumber: true,
          formReceived: true,
          start: true,
          finish: true,
          leader: true,
          codeTanki1: true,
          codeMesin: true,
          qtyAct: true,
          members: true,
          fineness: true,
          visco: true,
          suhu: true,
          remark: true,
          timestamp: true,
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
      prisma.colourMatchingLog.findMany({
        select: {
          order: true,
          orderQty: true,
          materialNumber: true,
          formReceived: true,
          start: true,
          finish: true,
          iuPlant: true,
          members: true,
          formPerMan: true,
          remark: true,
          timestamp: true,
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
      prisma.packingLog.findMany({
        select: {
          order: true,
          orderQty: true,
          materialNumber: true,
          materialDescription: true,
          batch: true,
          plant: true,
          iuPlant: true,
          codeTanki: true,
          spvName: true,
          leaderName: true,
          totalQty: true,
          qtyPerMan: true,
          formReceived: true,
          start: true,
          finish: true,
          remark: true,
          timestamp: true,
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
      prisma.checkResult.findMany({
        select: {
          order: true,
          orderQty: true,
          materialNumber: true,
          remark: true,
          timestamp: true,
          parameters: {
            orderBy: { no: "asc" },
            select: { parameter: true, standard: true, result: true, start: true, finish: true },
          },
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
      prisma.approvalSchedule.findMany({
        select: {
          order: true,
          materialNumber: true,
          orderQty: true,
          prepareProduksi: true,
          sendToTech: true,
          technicalDateReceiving: true,
          submitToCustomer: true,
          finishApp: true,
          remark: true,
          timestamp: true,
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
    ]);

    // Admin QC Stage/QC to App/QC Passed TIDAK LAGI di ApprovalSchedule --
    // dipindah ke tabel AdminQc terpisah (2026-07-28, menu "Input Admin QC").
    // Diambil di sini & digabung per Order (yg PALING BARU) supaya
    // approvalProcessLabel/dashboard tetap bisa baca ketiganya sama seperti
    // sebelum dipisah.
    const adminQcRows = await prisma.adminQc.findMany({
      select: { order: true, orderQty: true, typeLot: true, qcToApproval: true, qcPassed: true, remark: true, timestamp: true },
      orderBy: { timestamp: "desc" },
    });
    const latestAdminQcByOrder = new Map<string, (typeof adminQcRows)[number]>();
    for (const r of adminQcRows) {
      if (!latestAdminQcByOrder.has(r.order)) latestAdminQcByOrder.set(r.order, r);
    }

    // Set per tahap (utk kolom "Proses Bar") -- dari data yg SAMA yg sudah
    // di-fetch di atas, tidak perlu query lagi.
    const premixOrders = new Set(premixAftermix.filter((r) => r.section === "PREMIX").map((r) => r.order));
    const aftermixOrders = new Set(premixAftermix.filter((r) => r.section === "AFTERMIX").map((r) => r.order));
    const millingOrders = new Set(milling.map((r) => r.order));
    const colourMatchingOrders = new Set(colourMatching.map((r) => r.order));
    const packingOrders = new Set(packing.map((r) => r.order));
    const checkResultOrders = new Set(checkResults.map((r) => r.order));
    const approvalOrders = new Set(approvals.map((r) => r.order));

    // Set materialNumber PER TAHAP (siapapun Order-nya) -- dipakai utk
    // menentukan tahap mana saja yg RELEVAN ditampilkan sbg label utk 1
    // Material Number tertentu (baik yg sudah maupun BELUM dikerjakan Order
    // ybs), sesuai histori Material Number itu lintas Order/Batch manapun.
    function materialSet(rows: { materialNumber: string | null }[]): Set<string> {
      return new Set(rows.filter((r): r is { materialNumber: string } => r.materialNumber != null).map((r) => r.materialNumber));
    }
    const premixMaterials = materialSet(premixAftermix.filter((r) => r.section === "PREMIX"));
    const aftermixMaterials = materialSet(premixAftermix.filter((r) => r.section === "AFTERMIX"));
    const millingMaterials = materialSet(milling);
    const colourMatchingMaterials = materialSet(colourMatching);
    const packingMaterials = materialSet(packing);
    const checkResultMaterials = materialSet(checkResults);
    const approvalMaterials = materialSet(approvals);

    /**
     * Daftar tahap yg ditampilkan utk 1 Order = tahap yg PERNAH ada histori
     * Material Number-nya (lintas Order/Batch manapun) -- `done` per tahap
     * tetap dicek dari Order ybs SENDIRI. Jadi kalau Material X pernah
     * melalui Premix+QC (di Order lain/Batch lain), Order Y dgn Material X
     * yg baru sampai Aftermix akan tetap menampilkan label Premix & QC
     * (abu-abu, belum done) selain Aftermix (berwarna, done) -- supaya
     * tim MRP tahu keseluruhan rangkaian proses material ini, bukan cuma
     * progres Order ybs. Kalau materialNumber tidak diketahui (jarang
     * terjadi), fallback ke 7 tahap universal spy tetap ada acuan.
     */
    function computeStages(order: string, materialNumber: string | null): { name: string; done: boolean }[] {
      const defs = [
        { name: "Premix", doneSet: premixOrders, materialSet: premixMaterials },
        { name: "Milling", doneSet: millingOrders, materialSet: millingMaterials },
        { name: "Aftermix", doneSet: aftermixOrders, materialSet: aftermixMaterials },
        { name: "Colour Matching", doneSet: colourMatchingOrders, materialSet: colourMatchingMaterials },
        { name: "QC", doneSet: checkResultOrders, materialSet: checkResultMaterials },
        { name: "Approval", doneSet: approvalOrders, materialSet: approvalMaterials },
        { name: "Packing", doneSet: packingOrders, materialSet: packingMaterials },
      ];
      const relevant = materialNumber ? defs.filter((d) => d.materialSet.has(materialNumber)) : defs;
      return relevant.map((d) => ({ name: d.name, done: d.doneSet.has(order) }));
    }

    // Label Packing per Order utk kolom "Production Actions" -- mulai dari
    // Order yg SUDAH py baris PackingLog (Packing/Done), lalu ditambah Order
    // yg BELUM py baris PackingLog sama sekali tapi qcPassed-nya sudah terisi
    // ("List Antrian Packing", lihat GET /packing/queue) -- "QU - Packing".
    // Dua sumber ini SALING LEPAS (queuePackingOrders sudah memfilter
    // `!packingOrders.has(...)`), jadi aman digabung tanpa bentrok.
    const latestPackingRow = latestPackingRowByOrder(packing);
    const packingActionsByOrder = latestPackingLabelByOrder(latestPackingRow);
    const queuePackingOrders = Array.from(latestAdminQcByOrder.values()).filter(
      (a) => a.qcPassed != null && !packingOrders.has(a.order)
    );
    for (const a of queuePackingOrders) packingActionsByOrder.set(a.order, "QU - Packing");

    // Order yg Admin QC Stage-nya sudah "Approval"/"Joint Lot" tapi BELUM py
    // baris di ApprovalSchedule -- "List Antrian Approval" (lihat GET
    // /approvals/queue, filter-nya SENGAJA disamakan persis, TERMASUK tidak
    // mengecek status Packing sama sekali -- direvisi 2026-07-29, instruksi
    // eksplisit user: kolom "Proses" & "Production Actions" harus independen,
    // supaya tetap ketahuan kalau ada Order yg tim Packing-nya sudah input
    // duluan tapi administrasi Approval-nya belum selesai, BUKAN otomatis
    // dianggap "sudah lewat" cuma krn Packing kebetulan lebih dulu).
    const queueApprovalRows = Array.from(latestAdminQcByOrder.values())
      .filter((a) => (a.typeLot === "Approval" || a.typeLot === "Joint Lot") && !approvalOrders.has(a.order))
      .map((a) => ({
        order: a.order,
        orderQty: a.orderQty,
        process: "QU - Approval",
        start: a.qcToApproval,
        finish: null as Date | null,
        remark: a.remark,
        timestamp: a.qcToApproval ?? a.timestamp,
      }));

    const latestAftermixByOrder = new Map<string, (typeof premixAftermix)[number]>();
    for (const r of premixAftermix) {
      if (r.section !== "AFTERMIX") continue;
      if (!latestAftermixByOrder.has(r.order)) latestAftermixByOrder.set(r.order, r);
    }

    // Order yg ADA di Master Data Cooispi, Material Number-nya PERNAH py
    // histori Premix, tapi BELUM PERNAH diinput ke Premix maupun tahap
    // manapun setelahnya -- "PWO Schedule & Queue" Premix (lihat GET
    // /premix-aftermix/premix-pwo-queue, filter-nya disamakan persis).
    // Dipakai utk baris "QU - Premix" kolom "Proses" (2026-07-30, instruksi
    // eksplisit user). BEDA dari queueMillingRows/dst -- sumbernya Master
    // Data langsung (Premix tahap pertama, tidak py tahap sebelumnya), jadi
    // perlu fetch TERSENDIRI di luar Promise.all utama -- SENGAJA difilter
    // `materialNumber IN (...)` di level DB (bukan fetch semua ~500rb baris
    // Master Data ke memory) supaya tetap ringan.
    const allMasterOrders =
      premixMaterials.size > 0
        ? await prisma.masterOrder.findMany({
            where: { materialNumber: { in: Array.from(premixMaterials) } },
            select: { order: true, orderQty: true, materialNumber: true },
          })
        : [];
    const queuePremixRows = allMasterOrders
      .filter(
        (r) =>
          r.materialNumber != null &&
          !premixOrders.has(r.order) &&
          !millingOrders.has(r.order) &&
          !aftermixOrders.has(r.order) &&
          !colourMatchingOrders.has(r.order) &&
          !approvalOrders.has(r.order) &&
          !packingOrders.has(r.order)
      )
      .map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: "QU - Premix",
        start: null as Date | null,
        finish: null as Date | null,
        remark: null as string | null,
        // Master Data tidak py timestamp yg bisa diandalkan (lihat komentar
        // panjang di /premix-aftermix/premix-pwo-queue) -- SENGAJA pakai
        // epoch (paling lama) supaya baris ini HANYA menang kalau memang
        // tidak ada histori produksi apa pun lagi utk Order ini (fallback
        // paling rendah prioritasnya, bukan yg paling baru).
        timestamp: new Date(0),
      }));

    // Order yg Premix-nya sudah "Premix - DN", tapi BELUM py baris MillingLog
    // SAMA SEKALI -- "PWO Schedule & Queue" Milling (lihat GET
    // /milling/pwo-queue, filter-nya disamakan persis, TERMASUK tidak ada
    // syarat histori Material Number -- BEDA dari Aftermix/Colour Matching,
    // tidak diminta utk Milling). Dipakai utk baris "QU - Milling" kolom
    // "Proses" (2026-07-29, instruksi eksplisit user). Begitu SUDAH ada baris
    // MillingLog (walau baru Form Received), milling.map di bawah sudah
    // otomatis menangani labelnya sendiri (SAMA "QU - Milling" selama Start
    // belum terisi, lewat millingProcessLabel) -- sumber INI cuma ngisi gap
    // SEBELUM ada baris sama sekali.
    const latestPremixByOrder = new Map<string, (typeof premixAftermix)[number]>();
    for (const r of premixAftermix) {
      if (r.section !== "PREMIX") continue;
      if (!latestPremixByOrder.has(r.order)) latestPremixByOrder.set(r.order, r);
    }
    const queueMillingRows = Array.from(latestPremixByOrder.values())
      .filter(
        (r) =>
          premixProcessLabel(r) === "Premix - DN" &&
          !millingOrders.has(r.order) &&
          !aftermixOrders.has(r.order) &&
          !colourMatchingOrders.has(r.order) &&
          !approvalOrders.has(r.order) &&
          !packingOrders.has(r.order)
      )
      .map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: "QU - Milling",
        start: null as Date | null,
        finish: null as Date | null,
        remark: r.remark,
        // +1ms drpd Finish Premix -- SENGAJA supaya "QU - Milling" menang
        // tie-break drpd "Premix - DN" (baris Premix sendiri pakai timestamp
        // Finish yg SAMA persis), sama pola dgn queueAftermixRows/
        // queueColourMatchingRows.
        timestamp: new Date(r.finish!.getTime() + 1),
      }));

    // Order yg Milling-nya sudah "Milling - DN" DAN Material Number-nya
    // PERNAH py histori Aftermix, tapi BELUM py baris Aftermix SAMA SEKALI --
    // "PWO Schedule & Queue" Aftermix (lihat GET /premix-aftermix/
    // aftermix-pwo-queue, filter-nya disamakan persis). Dipakai utk baris
    // "QU - Aftermix" kolom "Proses" (2026-07-29, instruksi eksplisit user).
    // Begitu SUDAH ada baris Aftermix (walau baru Form Received),
    // premixAftermix.map di bawah sudah otomatis menangani labelnya sendiri
    // (SAMA "QU - Aftermix" selama Start belum terisi, lewat
    // aftermixProcessLabel) -- sumber INI cuma ngisi gap SEBELUM ada baris
    // sama sekali.
    const latestMillingByOrder = new Map<string, (typeof milling)[number]>();
    for (const r of milling) {
      if (!latestMillingByOrder.has(r.order)) latestMillingByOrder.set(r.order, r);
    }
    const queueAftermixRows = Array.from(latestMillingByOrder.values())
      .filter(
        (r) =>
          millingProcessLabel(r) === "Milling - DN" &&
          r.materialNumber != null &&
          aftermixMaterials.has(r.materialNumber) &&
          !aftermixOrders.has(r.order) &&
          !colourMatchingOrders.has(r.order) &&
          !approvalOrders.has(r.order) &&
          !packingOrders.has(r.order)
      )
      .map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: "QU - Aftermix",
        start: null as Date | null,
        finish: null as Date | null,
        remark: r.remark,
        // +1ms drpd Finish Milling -- SENGAJA supaya "QU - Aftermix" menang
        // tie-break drpd "Milling - DN" (baris Milling sendiri pakai
        // timestamp Finish yg SAMA persis), sama pola dgn queueColourMatchingRows.
        timestamp: new Date(r.finish!.getTime() + 1),
      }));

    // Order yg Aftermix-nya sudah "Aftermix - DN" DAN Material Number-nya
    // PERNAH py histori Colour Matching, tapi BELUM py baris ColourMatchingLog
    // SAMA SEKALI -- "PWO Schedule & Queue" Colour Matching (lihat GET
    // /colour-matching/pwo-queue, filter-nya disamakan persis). Dipakai utk
    // baris "QU - Colour Matching" kolom "Proses" (2026-07-29, instruksi
    // eksplisit user). Begitu SUDAH ada baris ColourMatchingLog (walau baru
    // Form Received), colourMatching.map di bawah sudah otomatis menangani
    // labelnya sendiri (SAMA "QU - Colour Matching" selama Start belum
    // terisi, lewat colourMatchingProcessLabel) -- sumber INI cuma ngisi gap
    // SEBELUM ada baris sama sekali.
    const queueColourMatchingRows = Array.from(latestAftermixByOrder.values())
      .filter(
        (r) =>
          aftermixProcessLabel(r) === "Aftermix - DN" &&
          r.materialNumber != null &&
          colourMatchingMaterials.has(r.materialNumber) &&
          !colourMatchingOrders.has(r.order) &&
          !approvalOrders.has(r.order) &&
          !packingOrders.has(r.order)
      )
      .map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: "QU - Colour Matching",
        start: null as Date | null,
        finish: null as Date | null,
        remark: r.remark,
        // +1ms drpd Finish Aftermix -- SENGAJA supaya "QU - Colour Matching"
        // menang tie-break drpd "Aftermix - DN" (baris Aftermix di bawah
        // pakai timestamp Finish yg SAMA persis) saat diurutkan "paling baru
        // menang". Order ini logisnya masuk antrian TEPAT setelah Aftermix
        // selesai, jadi wajar kalau lebih "baru" walau selisihnya cuma 1ms.
        timestamp: new Date(r.finish!.getTime() + 1),
      }));

    const rows: Omit<
      ProductionOrderRow,
      "materialNumber" | "materialDescription" | "batch" | "leadTimeProses" | "stages" | "progressPercent" | "productionActions"
    >[] = [
      ...premixAftermix.map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: r.section === "PREMIX" ? premixProcessLabel(r) : aftermixProcessLabel(r),
        start: r.start,
        finish: r.finish,
        remark: r.remark,
        timestamp: latestMoment(r.start, r.finish, r.timestamp),
      })),
      ...queuePremixRows,
      ...queueMillingRows,
      ...queueAftermixRows,
      ...milling.map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: millingProcessLabel(r),
        start: r.start,
        finish: r.finish,
        remark: r.remark,
        timestamp: latestMoment(r.start, r.finish, r.timestamp),
      })),
      ...colourMatching.map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: colourMatchingProcessLabel(r),
        start: r.start,
        finish: r.finish,
        remark: r.remark,
        timestamp: latestMoment(r.start, r.finish, r.timestamp),
      })),
      ...queueColourMatchingRows,
      ...checkResults.map((r) => {
        const rep = qcRepresentativeParam(r.parameters);
        // Label Proses QC direvisi TOTAL 2026-07-29 sesuai instruksi eksplisit
        // user, menggantikan format lama "QC : <Item Check> : <Verdict>" --
        // sekarang cuma 2 state: Order ada di "History Input Check Results"
        // (baris CheckResult ini sendiri) -> "QC"; DITAMBAH Order ybs QC
        // Passed-nya (tabel AdminQc, menu "History Admin QC") sudah terisi ->
        // "QC - DN". Popup detail Item Check (qcDetailOrder di frontend) TETAP
        // jalan spt biasa krn dipicu oleh nomor Order, bukan isi label ini.
        const adminQc = latestAdminQcByOrder.get(r.order);
        return {
          order: r.order,
          orderQty: r.orderQty,
          process: adminQc?.qcPassed ? "QC - DN" : "QC",
          start: rep?.start ?? null,
          finish: rep?.finish ?? null,
          remark: r.remark,
          // Beda dengan modul lain (pakai latestMoment/Finish-lalu-Start): QC
          // SENGAJA cuma pakai kolom Start Item Check terwakil saja (bukan Finish,
          // bukan timestamp Save header) -- sesuai instruksi eksplisit utk QC.
          timestamp: rep?.start ?? r.timestamp,
        };
      }),
      ...queueApprovalRows,
      ...approvals.map((r) => {
        const adminQc = latestAdminQcByOrder.get(r.order);
        return {
          order: r.order,
          orderQty: r.orderQty,
          process: finishBasedLabel("Approval", r.finishApp),
          // Start Proses tetap diambil dari "QC to App" (kolom History Admin
          // QC) spy konsisten sama sebelumnya; Finish Proses SEKARANG Finish
          // App langsung (bukan lagi QC Passed) -- sesuai instruksi 2026-07-29:
          // status "Approval - DN" ditentukan murni dari Finish App.
          start: adminQc?.qcToApproval ?? null,
          finish: r.finishApp,
          remark: r.remark,
          timestamp: latestMoment(adminQc?.qcToApproval ?? null, r.finishApp, r.timestamp),
        };
      }),
    ];

    // "Pertama kali Order ini dibuat" (utk Lead Time Proses) = baris TERCEPAT
    // yg pernah ter-Save utk Order ini, lintas SEMUA modul (bukan cuma yg
    // "menang" jadi Proses terakhir) -- pakai timestamp Save asli (BUKAN
    // latestMoment/Start yg sudah ditimpa di atas utk keperluan Proses).
    const createdAtEntries: { order: string; createdAt: Date }[] = [
      ...premixAftermix.map((r) => ({ order: r.order, createdAt: r.timestamp })),
      ...milling.map((r) => ({ order: r.order, createdAt: r.timestamp })),
      ...colourMatching.map((r) => ({ order: r.order, createdAt: r.timestamp })),
      ...packing.map((r) => ({ order: r.order, createdAt: r.timestamp })),
      ...checkResults.map((r) => ({ order: r.order, createdAt: r.timestamp })),
    ];
    const firstSeenByOrder = new Map<string, Date>();
    for (const e of createdAtEntries) {
      const existing = firstSeenByOrder.get(e.order);
      if (!existing || e.createdAt.getTime() < existing.getTime()) firstSeenByOrder.set(e.order, e.createdAt);
    }

    // Urutkan berdasarkan waktu input paling baru, lalu ambil HANYA 1 baris per
    // Order -- inputan terakhirnya saja. Utk QC field ini isinya kolom Start
    // (lihat map checkResults di atas), utk modul lain isinya timestamp Save.
    rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const latestByOrder = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByOrder.has(r.order)) latestByOrder.set(r.order, r);
    }
    const deduped = Array.from(latestByOrder.values());

    // Lookup terbaru dari Master Data Cooispi (MasterOrder), bukan snapshot History.
    const uniqueOrders = Array.from(latestByOrder.keys());
    const masterOrders = await prisma.masterOrder.findMany({
      where: { order: { in: uniqueOrders } },
      select: { order: true, materialNumber: true, materialDescription: true, batch: true },
    });
    const masterByOrder = new Map(masterOrders.map((m) => [m.order, m]));

    const now = new Date();
    // Filter teks pencarian (dulu di query, dipindah ke sini) diterapkan ke
    // Order yg DITAMPILKAN saja -- data lintas Order lainnya (Set per Material
    // Number di atas) tetap dihitung dari histori LENGKAP tanpa filter ini.
    const searchLower = search.toLowerCase();
    const filteredDeduped = search ? deduped.filter((r) => r.order.toLowerCase().includes(searchLower)) : deduped;
    const result: ProductionOrderRow[] = filteredDeduped.map((r) => {
      const master = masterByOrder.get(r.order);
      const firstSeen = firstSeenByOrder.get(r.order) ?? r.timestamp;
      const stages = computeStages(r.order, master?.materialNumber ?? null);
      const progressPercent = stages.length === 0 ? 0 : Math.round((stages.filter((s) => s.done).length / stages.length) * 100);
      // Begitu Order ybs SUDAH py baris nyata di History Packing, kolom Start
      // Proses/Finish Proses/Remark ambil dari SANA (bukan lagi dari
      // Premix/Milling/Aftermix/Colour Matching/Approval spt biasanya) --
      // sesuai instruksi eksplisit user (2026-07-29). Kalau Order cuma
      // "QU - Packing" (baru di antrian, belum py baris PackingLog beneran)
      // TIDAK ada override -- History Packing-nya sendiri memang belum ada
      // apa-apa, jadi 3 kolom itu tetap ikut logika lama.
      const packingRow = latestPackingRow.get(r.order);
      return {
        ...r,
        materialNumber: master?.materialNumber ?? null,
        materialDescription: master?.materialDescription ?? null,
        batch: master?.batch ?? null,
        start: packingRow ? packingRow.start : r.start,
        finish: packingRow ? packingRow.finish : r.finish,
        remark: packingRow ? packingRow.remark : r.remark,
        leadTimeProses: countBusinessDaysElapsed(firstSeen, now),
        stages,
        progressPercent,
        productionActions: packingActionsByOrder.get(r.order) ?? null,
      };
    });

    res.json({ success: true, data: result });
  })
);

interface TankTouch {
  code: string;
  order: string;
  materialNumber: string | null;
  batch: string | null;
  orderQty: string | null;
  remark: string | null;
  process: string;
  start: Date | null;
  finish: Date | null;
  moment: Date;
}

export interface TankStatusInfo {
  code: string;
  taTb: string | null;
  tankCapacity: string | null;
  newNumber: string | null;
  locationPlant: string | null;
  typeTanki: string | null;
  status: "occupied" | "empty";
  occupant: {
    order: string;
    materialNumber: string | null;
    materialDescription: string | null;
    batch: string | null;
    orderQty: string | null;
    remark: string | null;
    process: string;
    start: Date | null;
    finish: Date | null;
    since: Date;
    /** Label Proses Packing utk Order yg lagi megang tank ini, TERPISAH dari
     * `process` -- sesuai instruksi eksplisit user (2026-07-28). Lihat
     * latestPackingLabelByOrder. */
    productionActions: string | null;
  } | null;
}

/**
 * Status okupansi tiap Tank (dipakai Dashboard > Tank Monitoring, DAN Dashboard
 * > Production Order Monitoring utk kolom Code Tanki/Type/Kapasitas/Lokasi/
 * Status) -- diturunkan dari Code Tanki yg diisi di SEMUA modul Input Proses
 * (Premix/Aftermix, Milling -- py 2 slot: Couple & Moving, Colour Matching,
 * Packing, Approval, QC), BUKAN dari field status eksplisit (tidak ada di
 * sistem ini).
 *
 * Aturannya: per kode Tank, ambil "sentuhan" (touch) PALING BARU lintas SEMUA
 * Order manapun (bukan per Order) -- itulah Order yg diasumsikan SEDANG
 * memegang tank itu sekarang. Tank dianggap "Terisi" SELAMA Order tsb belum
 * py entri Packing (tahap TERAKHIR di STAGE_SEQUENCE dashboard Production
 * Order Monitoring -- lihat menu.tsx & ProductionOrderDashboardPage) --
 * begitu Packing utk Order itu sudah diinput, tank dianggap sudah
 * dikosongkan/dibersihkan lagi ("Kosong"). Tank yg belum pernah tersentuh
 * modul manapun juga dianggap "Kosong".
 */
async function buildTankStatusMap(): Promise<Map<string, TankStatusInfo>> {
  const [tanks, premixAftermix, milling, colourMatching, packing, approvals, adminQcRowsForTank, checkResults] = await Promise.all([
    prisma.masterTank.findMany({ orderBy: { code: "asc" } }),
    prisma.premixAftermixLog.findMany({
      select: { order: true, materialNumber: true, batch: true, orderQty: true, remark: true, section: true, codeTanki: true, start: true, finish: true, timestamp: true },
    }),
    prisma.millingLog.findMany({
      select: { order: true, materialNumber: true, batch: true, orderQty: true, remark: true, codeTanki1: true, codeTanki2: true, start: true, finish: true, timestamp: true },
    }),
    prisma.colourMatchingLog.findMany({
      select: { order: true, materialNumber: true, batch: true, orderQty: true, remark: true, codeTanki: true, start: true, finish: true, timestamp: true },
    }),
    prisma.packingLog.findMany({
      select: {
        order: true,
        materialNumber: true,
        materialDescription: true,
        batch: true,
        orderQty: true,
        plant: true,
        iuPlant: true,
        remark: true,
        codeTanki: true,
        spvName: true,
        leaderName: true,
        totalQty: true,
        qtyPerMan: true,
        formReceived: true,
        start: true,
        finish: true,
        timestamp: true,
      },
    }),
    prisma.approvalSchedule.findMany({
      select: {
        order: true,
        materialNumber: true,
        batch: true,
        orderQty: true,
        remark: true,
        codeTanki: true,
        prepareProduksi: true,
        sendToTech: true,
        technicalDateReceiving: true,
        submitToCustomer: true,
        finishApp: true,
        timestamp: true,
      },
    }),
    // Admin QC Stage/QC to App/QC Passed TIDAK LAGI di ApprovalSchedule --
    // lihat komentar sama di /production-orders di atas.
    prisma.adminQc.findMany({
      select: { order: true, typeLot: true, qcToApproval: true, qcPassed: true, timestamp: true },
      orderBy: { timestamp: "desc" },
    }),
    prisma.checkResult.findMany({
      select: {
        order: true,
        materialNumber: true,
        batch: true,
        orderQty: true,
        remark: true,
        codeTanki: true,
        timestamp: true,
        // Start/Finish HEADER CheckResult SENGAJA tidak dipakai -- field itu tidak
        // pernah diisi dari form Input Check Results (Start/Finish di form itu
        // per Item Check, bukan per header). Proses/Start/Finish QC dihitung dari
        // Item Check TERWAKIL (qcRepresentativeParam/qcProcessLabel) -- fungsi &
        // logika yg SAMA PERSIS dgn kolom "Proses" di /production-orders, supaya
        // format "QC : Item Check : Verdict" konsisten di seluruh dashboard.
        parameters: {
          orderBy: { no: "asc" },
          select: { parameter: true, standard: true, result: true, start: true, finish: true },
        },
      },
    }),
  ]);

  const packingOrders = new Set(packing.map((r) => r.order));

  const touches: TankTouch[] = [];
  for (const r of premixAftermix) {
    if (!r.codeTanki) continue;
    touches.push({
      code: r.codeTanki,
      order: r.order,
      materialNumber: r.materialNumber,
      batch: r.batch,
      orderQty: r.orderQty,
      remark: r.remark,
      process: r.section === "PREMIX" ? "Premix" : "Aftermix",
      start: r.start,
      finish: r.finish,
      moment: latestMoment(r.start, r.finish, r.timestamp),
    });
  }
  for (const r of milling) {
    const moment = latestMoment(r.start, r.finish, r.timestamp);
    if (r.codeTanki1) {
      touches.push({ code: r.codeTanki1, order: r.order, materialNumber: r.materialNumber, batch: r.batch, orderQty: r.orderQty, remark: r.remark, process: "Milling (Couple)", start: r.start, finish: r.finish, moment });
    }
    if (r.codeTanki2) {
      touches.push({ code: r.codeTanki2, order: r.order, materialNumber: r.materialNumber, batch: r.batch, orderQty: r.orderQty, remark: r.remark, process: "Milling (Moving)", start: r.start, finish: r.finish, moment });
    }
  }
  for (const r of colourMatching) {
    if (!r.codeTanki) continue;
    touches.push({
      code: r.codeTanki,
      order: r.order,
      materialNumber: r.materialNumber,
      batch: r.batch,
      orderQty: r.orderQty,
      remark: r.remark,
      process: "Colour Matching",
      start: r.start,
      finish: r.finish,
      moment: latestMoment(r.start, r.finish, r.timestamp),
    });
  }
  // Packing SENGAJA TIDAK ikut jadi "touch" di Tank Monitoring (kandidat
  // okupansi tank) -- beda topik dari kolom "Proses" di /production-orders
  // (yg SEKARANG per 2026-07-29 sudah mengikutkan Packing lagi, lihat
  // finishBasedLabel di atas). Di SINI Packing tetap dikecualikan krn
  // freeing-logic tank (`packingOrders` Set di atas) sudah menjadikan
  // Packing sbg PENANDA "tank dikosongkan lagi", bukan tahap okupansi --
  // memasukkannya jadi touch juga akan kontradiktif dgn logika freeing itu.
  const latestAdminQcByOrderForTank = new Map<string, (typeof adminQcRowsForTank)[number]>();
  for (const r of adminQcRowsForTank) {
    if (!latestAdminQcByOrderForTank.has(r.order)) latestAdminQcByOrderForTank.set(r.order, r);
  }
  for (const r of approvals) {
    if (!r.codeTanki) continue;
    // Label Proses Approval/Approval - DN murni dari Finish App (SAMA
    // PERSIS dgn /production-orders, lihat finishBasedLabel) -- Start dari
    // "QC to App" (tabel AdminQc) spy konsisten sama sebelumnya.
    const adminQc = latestAdminQcByOrderForTank.get(r.order);
    touches.push({
      code: r.codeTanki,
      order: r.order,
      materialNumber: r.materialNumber,
      batch: r.batch,
      orderQty: r.orderQty,
      remark: r.remark,
      process: finishBasedLabel("Approval", r.finishApp),
      start: adminQc?.qcToApproval ?? null,
      finish: r.finishApp,
      moment: latestMoment(adminQc?.qcToApproval ?? null, r.finishApp, r.timestamp),
    });
  }
  for (const r of checkResults) {
    if (!r.codeTanki) continue;
    const rep = qcRepresentativeParam(r.parameters);
    touches.push({
      code: r.codeTanki,
      order: r.order,
      materialNumber: r.materialNumber,
      batch: r.batch,
      orderQty: r.orderQty,
      remark: r.remark,
      process: qcProcessLabel(rep),
      start: rep?.start ?? null,
      finish: rep?.finish ?? null,
      moment: rep?.start ?? r.timestamp,
    });
  }

  // Per kode Tank, ambil touch PALING BARU (lintas Order manapun) -- itulah
  // Order yg diasumsikan sedang memegang tank itu sekarang.
  const latestByTank = new Map<string, TankTouch>();
  for (const t of touches) {
    const existing = latestByTank.get(t.code);
    if (!existing || t.moment.getTime() > existing.moment.getTime()) latestByTank.set(t.code, t);
  }

  // Material Description SENGAJA di-lookup ulang dari Master Data Cooispi
  // (bukan snapshot History) -- sama alasannya dgn /production-orders.
  const orderNumbers = Array.from(new Set(Array.from(latestByTank.values()).map((t) => t.order)));
  const masterOrders = await prisma.masterOrder.findMany({
    where: { order: { in: orderNumbers } },
    select: { order: true, materialDescription: true },
  });
  const descByOrder = new Map(masterOrders.map((m) => [m.order, m.materialDescription]));
  const packingActionsByOrder = latestPackingLabelByOrder(latestPackingRowByOrder(packing));

  const map = new Map<string, TankStatusInfo>();
  for (const tank of tanks) {
    const touch = latestByTank.get(tank.code);
    const orderDone = touch ? packingOrders.has(touch.order) : true;
    const occupied = Boolean(touch) && !orderDone;
    map.set(tank.code, {
      code: tank.code,
      taTb: tank.taTb,
      tankCapacity: tank.tankCapacity,
      newNumber: tank.newNumber,
      locationPlant: tank.locationPlant,
      typeTanki: tank.typeTanki,
      status: occupied ? "occupied" : "empty",
      occupant:
        occupied && touch
          ? {
              order: touch.order,
              materialNumber: touch.materialNumber,
              materialDescription: descByOrder.get(touch.order) ?? null,
              batch: touch.batch,
              orderQty: touch.orderQty,
              remark: touch.remark,
              process: touch.process,
              start: touch.start,
              finish: touch.finish,
              since: touch.moment,
              productionActions: packingActionsByOrder.get(touch.order) ?? null,
            }
          : null,
    });
  }
  return map;
}

dashboardRouter.get(
  "/tank-status",
  asyncRoute(async (req, res) => {
    const map = await buildTankStatusMap();
    res.json({ success: true, data: Array.from(map.values()) });
  })
);

interface StageLeadTime {
  process: string;
  start: Date | null;
  finish: Date | null;
  /** null = proses ini belum py data Start sama sekali (belum dikerjakan). */
  leadTimeHariKerja: number | null;
}

function buildStage(process: string, start: Date | null, finish: Date | null, now: Date): StageLeadTime {
  if (!start) return { process, start: null, finish: null, leadTimeHariKerja: null };
  return { process, start, finish, leadTimeHariKerja: countBusinessDaysElapsed(start, finish ?? now) };
}

/**
 * Breakdown "Lead Time Proses" per tahapan (Premix, Aftermix, Milling, Colour
 * Matching, Packing, QC) utk 1 Order -- dipakai popup di kolom Lead Time
 * Proses supaya tim Produksi/MRP bisa lihat tahapan mana yang paling lama.
 * QC digabung jadi 1 baris (Start = paling awal, Finish = paling akhir di
 * antara SEMUA Item Check) -- bukan per Item Check, krn di sini yg dilihat
 * adalah durasi tahap QC secara keseluruhan, bukan hasil per parameter
 * (itu sudah ada di popup kolom Proses).
 */
dashboardRouter.get(
  "/production-orders/:order/stage-lead-times",
  asyncRoute(async (req, res) => {
    const order = req.params.order.trim();

    const [premixAftermix, milling, colourMatching, packing, checkResult, approval, adminQc] = await Promise.all([
      prisma.premixAftermixLog.findMany({
        where: { order },
        select: { section: true, start: true, finish: true },
        orderBy: { timestamp: "desc" },
      }),
      prisma.millingLog.findFirst({ where: { order }, select: { start: true, finish: true }, orderBy: { timestamp: "desc" } }),
      prisma.colourMatchingLog.findFirst({ where: { order }, select: { start: true, finish: true }, orderBy: { timestamp: "desc" } }),
      prisma.packingLog.findFirst({ where: { order }, select: { start: true, finish: true }, orderBy: { timestamp: "desc" } }),
      prisma.checkResult.findFirst({
        where: { order },
        select: { parameters: { select: { start: true, finish: true } } },
        orderBy: { timestamp: "desc" },
      }),
      // Approval tidak py kolom Start/Finish yg literal -- "Start"-nya QC to
      // App (sekarang di tabel AdminQc terpisah, lihat query di bawah),
      // "Finish"-nya Finish App, sesuai permintaan eksplisit user (2026-07-28)
      // utk merangkum SEMUA tahap termasuk Approval.
      prisma.approvalSchedule.findFirst({
        where: { order },
        select: { finishApp: true },
        orderBy: { timestamp: "desc" },
      }),
      prisma.adminQc.findFirst({
        where: { order },
        select: { qcToApproval: true },
        orderBy: { timestamp: "desc" },
      }),
    ]);

    const premix = premixAftermix.find((r) => r.section === "PREMIX");
    const aftermix = premixAftermix.find((r) => r.section === "AFTERMIX");

    let qcStart: Date | null = null;
    let qcFinish: Date | null = null;
    for (const p of checkResult?.parameters ?? []) {
      if (p.start && (!qcStart || p.start.getTime() < qcStart.getTime())) qcStart = p.start;
      if (p.finish && (!qcFinish || p.finish.getTime() > qcFinish.getTime())) qcFinish = p.finish;
    }

    // Urutan SAMA PERSIS dgn STAGE_SEQUENCE di ProductionOrderDashboardPage.tsx.
    const now = new Date();
    const stages: StageLeadTime[] = [
      buildStage("Premix", premix?.start ?? null, premix?.finish ?? null, now),
      buildStage("Milling", milling?.start ?? null, milling?.finish ?? null, now),
      buildStage("Aftermix", aftermix?.start ?? null, aftermix?.finish ?? null, now),
      buildStage("Colour Matching", colourMatching?.start ?? null, colourMatching?.finish ?? null, now),
      buildStage("QC", qcStart, qcFinish, now),
      buildStage("Approval", adminQc?.qcToApproval ?? null, approval?.finishApp ?? null, now),
      buildStage("Packing", packing?.start ?? null, packing?.finish ?? null, now),
    ].filter((s) => s.start != null);

    res.json({ success: true, data: stages });
  })
);

interface ProcessRemark {
  process: string;
  remark: string | null;
  timestamp: Date;
}

/**
 * Remark tiap tahap (Premix, Aftermix, Milling, Colour Matching, QC, Approval,
 * Packing) utk 1 Order -- dipakai popup di kolom "Remark" Dashboard. Beda
 * dari kolom "Remark" di baris utama (yg cuma nampilin Remark dari INPUT
 * PALING TERAKHIR lintas modul), popup ini nampilin Remark dari SEMUA modul
 * yg pernah py entri utk Order ini sekaligus -- krn sejak Remark tiap proses
 * dipisah (tidak lagi saling mewarisi antar modul), Remark Premix/Aftermix/
 * dst bisa beda-beda dan histori lengkapnya perlu tetap terlihat di 1 tempat.
 */
dashboardRouter.get(
  "/production-orders/:order/remarks",
  asyncRoute(async (req, res) => {
    const order = req.params.order.trim();

    const [premixAftermix, milling, colourMatching, packing, checkResult, approval] = await Promise.all([
      prisma.premixAftermixLog.findMany({
        where: { order },
        select: { section: true, remark: true, timestamp: true },
        orderBy: { timestamp: "desc" },
      }),
      prisma.millingLog.findFirst({ where: { order }, select: { remark: true, timestamp: true }, orderBy: { timestamp: "desc" } }),
      prisma.colourMatchingLog.findFirst({ where: { order }, select: { remark: true, timestamp: true }, orderBy: { timestamp: "desc" } }),
      prisma.packingLog.findFirst({ where: { order }, select: { remark: true, timestamp: true }, orderBy: { timestamp: "desc" } }),
      prisma.checkResult.findFirst({ where: { order }, select: { remark: true, timestamp: true }, orderBy: { timestamp: "desc" } }),
      prisma.approvalSchedule.findFirst({ where: { order }, select: { remark: true, timestamp: true }, orderBy: { timestamp: "desc" } }),
    ]);

    const premix = premixAftermix.find((r) => r.section === "PREMIX");
    const aftermix = premixAftermix.find((r) => r.section === "AFTERMIX");

    const rows: ProcessRemark[] = [
      premix && { process: "Premix", remark: premix.remark, timestamp: premix.timestamp },
      milling && { process: "Milling", remark: milling.remark, timestamp: milling.timestamp },
      aftermix && { process: "Aftermix", remark: aftermix.remark, timestamp: aftermix.timestamp },
      colourMatching && { process: "Colour Matching", remark: colourMatching.remark, timestamp: colourMatching.timestamp },
      checkResult && { process: "QC", remark: checkResult.remark, timestamp: checkResult.timestamp },
      approval && { process: "Approval", remark: approval.remark, timestamp: approval.timestamp },
      packing && { process: "Packing", remark: packing.remark, timestamp: packing.timestamp },
    ].filter((r): r is ProcessRemark => Boolean(r));

    res.json({ success: true, data: rows });
  })
);
