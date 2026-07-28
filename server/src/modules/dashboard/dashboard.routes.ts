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
  iuPlant: string | null;
  members: unknown;
  formPerMan: string | null;
}

/**
 * Label Proses granular Colour Matching -- direvisi 2026-07-26 sesuai
 * instruksi eksplisit user (dulu cuma 3 label berbasis Start/Finish: "Queue
 * Colour Matching"/"Colour Matching"/"Oke Colour Matching", krn Form Received
 * dulu SELALU wajib). Sekarang Form Received sendiri jadi tahap pertama yg
 * opsional -- pola SAMA PERSIS dgn premixOrAftermixProcessLabel/
 * millingProcessLabel: tahapan ditentukan dari kolom PALING LANJUT yg sudah
 * terisi (Form Received -> Start -> Finish), dgn syarat kolom pendukung tahap
 * itu (IU Plant, lalu Member & Form/Man begitu Start terisi) juga sudah
 * terisi -- SAMA PERSIS dgn superRefine di colourMatching.routes.ts. Dicek
 * dari yg paling lanjut (Finish) turun ke yg paling awal (Form Received).
 */
function colourMatchingProcessLabel(r: ColourMatchingStageFields): string {
  const hasIuPlant = Boolean(r.iuPlant && r.iuPlant.trim());
  const hasMembers = Array.isArray(r.members) && r.members.length > 0;
  const hasFormPerMan = Boolean(r.formPerMan && r.formPerMan.trim());
  if (r.finish && r.start && r.formReceived && hasIuPlant && hasMembers && hasFormPerMan) return "Colour Matching - DN";
  if (r.start && r.formReceived && hasIuPlant && hasMembers && hasFormPerMan) return "Colour Matching";
  if (r.formReceived && hasIuPlant) return "QU - Colour Matching";
  return "-";
}

interface PremixStageFields {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
  leader: string | null;
  qtyPerMan: string | null;
  members: unknown;
}

/**
 * Label Proses granular PREMIX & AFTERMIX -- SAMA PERSIS logikanya (cuma beda
 * nama tahap di labelnya), krn kedua section berbagi 1 model & 1 superRefine
 * yg identik di premixAftermix.routes.ts (direvisi 2026-07-26 supaya AFTERMIX
 * ikut dapat tahapan granular yg sama dgn PREMIX, bukan lagi label statis
 * "Aftermix"). Tahapan ditentukan dari kolom PALING LANJUT yg sudah terisi
 * (Form Received -> Start -> Finish), dgn syarat kolom pendukung tahap itu
 * (Leader, lalu Member & Qty/Man (Liter) begitu Start terisi) juga sudah
 * terisi. Dicek dari yg paling lanjut (Finish) turun ke yg paling awal
 * (Form Received).
 */
function premixOrAftermixProcessLabel(r: PremixStageFields, stageName: "Premix" | "Aftermix"): string {
  const hasLeader = Boolean(r.leader && r.leader.trim());
  const hasMembers = Array.isArray(r.members) && r.members.length > 0;
  const hasQtyPerMan = Boolean(r.qtyPerMan && r.qtyPerMan.trim());
  if (r.finish && r.start && r.formReceived && hasLeader && hasMembers && hasQtyPerMan) return `${stageName} - DN`;
  if (r.start && r.formReceived && hasLeader && hasMembers && hasQtyPerMan) return stageName;
  if (r.formReceived && hasLeader) return `QU - ${stageName}`;
  return "-";
}

interface MillingStageFields {
  formReceived: Date | null;
  start: Date | null;
  finish: Date | null;
  leader: string | null;
  codeTanki1: string | null;
  codeMesin: string | null;
  qtyAct: string | null;
  members: unknown;
  fineness: unknown;
  visco: unknown;
  suhu: unknown;
}

/**
 * Label Proses granular Milling -- tahapan ditentukan dari kolom PALING
 * LANJUT yg sudah terisi (Form Received -> Start -> Finish), dgn syarat
 * kolom pendukung tahap itu (Leader, Code Tanki 1, Code Mesin, lalu Member,
 * Qty Act, Fineness, Visco, & Suhu begitu Start terisi) juga sudah terisi --
 * SAMA PERSIS dgn superRefine di milling.routes.ts, sesuai instruksi
 * eksplisit user (2026-07-26). Code Tanki 2 SENGAJA TIDAK dicek di sini --
 * itu auto-terisi dari Premix, bukan syarat wajib manual. "Ada isi" utk
 * Fineness/Visco/Suhu cukup salah satu dari 10 slot terisi (bukan semua 10).
 */
function millingProcessLabel(r: MillingStageFields): string {
  const hasLeader = Boolean(r.leader && r.leader.trim());
  const hasCodeTanki1 = Boolean(r.codeTanki1 && r.codeTanki1.trim());
  const hasCodeMesin = Boolean(r.codeMesin && r.codeMesin.trim());
  const hasMembers = Array.isArray(r.members) && r.members.length > 0;
  const hasQtyAct = Boolean(r.qtyAct && r.qtyAct.trim());
  const hasReadings = (v: unknown) => Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim().length > 0);
  const hasFineness = hasReadings(r.fineness);
  const hasVisco = hasReadings(r.visco);
  const hasSuhu = hasReadings(r.suhu);
  const tier1Ok = hasLeader && hasCodeTanki1 && hasCodeMesin;
  const tier2Ok = tier1Ok && hasMembers && hasQtyAct && hasFineness && hasVisco && hasSuhu;
  if (r.finish && r.start && r.formReceived && tier2Ok) return "Milling - DN";
  if (r.start && r.formReceived && tier2Ok) return "Milling";
  if (r.formReceived && tier1Ok) return "QU - Milling";
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
}

/**
 * "Kolom inti" Packing yg jadi syarat wajib di SEMUA tahap Proses granular di
 * bawah (SPV Produksi, Leader, Order, Material Number, Material Description,
 * Batch, Order Qty, Plant, IU Plant, Code Tanki, Volume) -- SAMA PERSIS dgn
 * packingCoreFieldsFilled di PackingPage.tsx. "Volume" = kolom totalQty.
 * Qty/Man SENGAJA TIDAK dimasukkan di sini -- itu cuma syarat tahap
 * Packing/Done, lihat packingProcessLabel (direvisi 2026-07-24).
 */
function packingCoreFieldsFilled(r: PackingStageFields): boolean {
  return Boolean(
    r.order &&
      r.materialNumber &&
      r.materialDescription &&
      r.batch &&
      r.orderQty &&
      r.plant &&
      r.iuPlant &&
      r.codeTanki &&
      r.spvName &&
      r.leaderName &&
      r.totalQty
  );
}

/**
 * Label Proses Packing -- tahapan granular ditentukan dari kolom PALING
 * LANJUT yg sudah terisi (Form Received -> Start -> Finish), dgn syarat
 * "kolom inti" (lihat packingCoreFieldsFilled) DAN semua kolom tahap
 * sebelumnya juga sudah terisi -- SAMA PERSIS dgn packingProcessLabel di
 * PackingPage.tsx, supaya label Proses di dashboard ini konsisten dgn label
 * di History Packing sendiri (direvisi 2026-07-24: Qty/Man dimunculkan lagi,
 * jadi syarat WAJIB tahap "Packing" & "Done" -- TAPI BUKAN syarat tahap
 * "QU - PC", sesuai instruksi eksplisit).
 */
function packingProcessLabel(r: PackingStageFields): string {
  if (!packingCoreFieldsFilled(r)) return "-";
  if (r.finish && r.start && r.formReceived && r.qtyPerMan) return "Done";
  if (r.start && r.formReceived && r.qtyPerMan) return "Packing";
  if (r.formReceived) return "QU - PC";
  return "-";
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
 * Label Packing PALING TERAKHIR per Order -- dipakai utk kolom terpisah
 * "Production Actions" di Dashboard Production Order Monitoring & Tank
 * Monitoring, sesuai instruksi eksplisit user (2026-07-28): kolom "Proses"
 * cuma boleh diisi Premix/Milling/Aftermix/Colour Matching/QC/Approval --
 * Packing TIDAK lagi ikut diadu jadi kandidat "paling akhir" utk kolom itu
 * (lihat pemanggil -- Packing SENGAJA tidak dimasukkan ke array `rows`/
 * `touches` yg dipakai utk menentukan pemenang "Proses").
 */
function latestPackingLabelByOrder(rows: (PackingStageFields & { timestamp: Date })[]): Map<string, string> {
  const latestByOrder = new Map<string, { moment: Date; row: PackingStageFields }>();
  for (const r of rows) {
    const moment = latestMoment(r.start, r.finish, r.timestamp);
    const existing = latestByOrder.get(r.order);
    if (!existing || moment.getTime() > existing.moment.getTime()) latestByOrder.set(r.order, { moment, row: r });
  }
  const labels = new Map<string, string>();
  for (const [order, { row }] of latestByOrder) labels.set(order, packingProcessLabel(row));
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

interface ApprovalStageFields {
  typeLot: string | null;
  qcToApproval: Date | null;
  prepareProduksi: Date | null;
  sendToTech: Date | null;
  technicalDateReceiving: Date | null;
  submitToCustomer: Date | null;
  finishApp: Date | null;
}

/**
 * Label Proses utk Approval (Production & MRP Schedule > Approval) -- direvisi
 * total 2026-07-28 sesuai instruksi eksplisit user, menggantikan skema lama
 * (AP - OK/Cust/SubmTech/Tech/Prep-AP/QC-AP). Tahapan sekarang py 2 sumbu:
 * 1) "Admin QC Stage" (kolom typeLot) menentukan label AWAL (Improve/Joint
 *    Lot/Lot Packing/Approval) sebelum production/technical input dimulai.
 * 2) Begitu salah satu dari Prepare Date/Send To Tech/Submit Tech sudah
 *    terisi, labelnya jadi "QU - Approval" TERLEPAS dari Admin QC Stage yg
 *    dipilih (lihat superRefine di approval.routes.ts -- tahap ini SELALU
 *    mewajibkan QC to App terisi juga, jadi baris ini valid utk cabang mana
 *    pun kecuali Improve murni). Submit Cust/Finish App py labelnya sendiri.
 * Dicek dari yg paling lanjut turun ke yg paling awal, krn tiap tahap
 * berikutnya mewajibkan SEMUA tahap sebelumnya (validasi kumulatif).
 */
function approvalProcessLabel(a: ApprovalStageFields): string | null {
  if (a.finishApp) return "Approval - DN";
  if (a.submitToCustomer) return "Approval";
  if (a.technicalDateReceiving || a.sendToTech || a.prepareProduksi) return "QU - Approval";
  if (a.typeLot === "Approval") return "QU - Approval";
  if (a.typeLot === "Lot Packing") return "QC - DN";
  if (a.typeLot === "Joint Lot") return "QC - Joint Lot";
  if (a.typeLot === "Improve") return "Improve";
  return null;
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
      select: { order: true, typeLot: true, qcToApproval: true, qcPassed: true, timestamp: true },
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

    // Label Packing per Order, dipakai kolom "Production Actions" TERPISAH di
    // bawah -- Packing SENGAJA TIDAK dimasukkan ke `rows` (kandidat pemenang
    // kolom "Proses"/Start Proses/Finish Proses/Remark), sesuai instruksi
    // eksplisit user (2026-07-28): kolom "Proses" cuma boleh diisi
    // Premix/Milling/Aftermix/Colour Matching/QC/Approval.
    const packingActionsByOrder = latestPackingLabelByOrder(packing);

    const rows: Omit<
      ProductionOrderRow,
      "materialNumber" | "materialDescription" | "batch" | "leadTimeProses" | "stages" | "progressPercent" | "productionActions"
    >[] = [
      ...premixAftermix.map((r) => ({
        order: r.order,
        orderQty: r.orderQty,
        process: premixOrAftermixProcessLabel(r, r.section === "PREMIX" ? "Premix" : "Aftermix"),
        start: r.start,
        finish: r.finish,
        remark: r.remark,
        timestamp: latestMoment(r.start, r.finish, r.timestamp),
      })),
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
      ...checkResults.map((r) => {
        const rep = qcRepresentativeParam(r.parameters);
        return {
          order: r.order,
          orderQty: r.orderQty,
          process: qcProcessLabel(rep),
          start: rep?.start ?? null,
          finish: rep?.finish ?? null,
          remark: r.remark,
          // Beda dengan modul lain (pakai latestMoment/Finish-lalu-Start): QC
          // SENGAJA cuma pakai kolom Start Item Check terwakil saja (bukan Finish,
          // bukan timestamp Save header) -- sesuai instruksi eksplisit utk QC.
          timestamp: rep?.start ?? r.timestamp,
        };
      }),
      ...approvals
        .map((r) => {
          const adminQc = latestAdminQcByOrder.get(r.order);
          const merged = { ...r, typeLot: adminQc?.typeLot ?? null, qcToApproval: adminQc?.qcToApproval ?? null };
          const process = approvalProcessLabel(merged);
          if (!process) return null;
          return {
            order: r.order,
            orderQty: r.orderQty,
            process,
            // Start/Finish Proses utk Approval SENGAJA diambil dari "QC to App"
            // dan "QC Passed" (kolom History Admin QC -- sejak Admin QC dipisah
            // jadi tabel & menu sendiri 2026-07-28), BUKAN Finish App atau tgl
            // tahap aktif lainnya -- berlaku utk semua label Proses granular
            // Approval (Improve/QC - Joint Lot/QC - DN/QU - Approval/Approval/
            // Approval - DN), sesuai instruksi eksplisit user.
            start: adminQc?.qcToApproval ?? null,
            finish: adminQc?.qcPassed ?? null,
            remark: r.remark,
            // Dipakai juga sbg acuan "paling baru" lintas modul (pola sama dgn QC
            // yg pakai Start Item Check) -- fallback ke timestamp Save kalau QC to
            // App kosong tapi tahap yg lebih lanjut sudah terisi (jarang terjadi).
            timestamp: adminQc?.qcToApproval ?? r.timestamp,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
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
      return {
        ...r,
        materialNumber: master?.materialNumber ?? null,
        materialDescription: master?.materialDescription ?? null,
        batch: master?.batch ?? null,
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
  // Packing SENGAJA TIDAK ikut jadi "touch" (kandidat okupansi/label Proses
  // tank) -- sesuai instruksi eksplisit user (2026-07-28), sama alasannya dgn
  // /production-orders. `packingOrders` Set di atas (freeing logic) tetap
  // dihitung independen dari data Packing yg sama, jadi perilaku "tank
  // dikosongkan lagi begitu Order-nya sudah Packing" TIDAK berubah.
  // Admin QC Stage/QC to App/QC Passed TIDAK LAGI di ApprovalSchedule --
  // lihat komentar sama di /production-orders.
  const latestAdminQcByOrderForTank = new Map<string, (typeof adminQcRowsForTank)[number]>();
  for (const r of adminQcRowsForTank) {
    if (!latestAdminQcByOrderForTank.has(r.order)) latestAdminQcByOrderForTank.set(r.order, r);
  }
  for (const r of approvals) {
    if (!r.codeTanki) continue;
    // Label Proses granular (bukan "Approval" statis) + Start/Finish dari "QC
    // to App"/"QC Passed" (tabel AdminQc, sejak dipisah dari ApprovalSchedule
    // 2026-07-28) -- SAMA PERSIS dgn /production-orders.
    const adminQc = latestAdminQcByOrderForTank.get(r.order);
    const merged = { ...r, typeLot: adminQc?.typeLot ?? null, qcToApproval: adminQc?.qcToApproval ?? null };
    touches.push({
      code: r.codeTanki,
      order: r.order,
      materialNumber: r.materialNumber,
      batch: r.batch,
      orderQty: r.orderQty,
      remark: r.remark,
      process: approvalProcessLabel(merged) ?? "Approval",
      start: adminQc?.qcToApproval ?? null,
      finish: adminQc?.qcPassed ?? null,
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
  const packingActionsByOrder = latestPackingLabelByOrder(packing);

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
