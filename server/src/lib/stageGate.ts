import { prisma } from "./prisma";

/**
 * Penguncian urutan tahap produksi (2026-07-31, instruksi eksplisit bos user
 * lewat user: sistem harus "baku" -- Order TIDAK BOLEH diinput ke tahap
 * berikutnya kalau tahap sebelumnya belum "-DN" utk Order yg SAMA). Sebelum
 * ini, SEMUA tahap bisa diisi Order apa saja tanpa dicek sama sekali --
 * fitur "PWO Schedule & Queue" tiap menu sudah tahu syarat yg benar, tapi
 * cuma tampilan saran, tidak pernah dipakai sbg gerbang di POST manapun.
 *
 * "-DN" didefinisikan SAMA PERSIS dgn badge "[Tahap] - DN" yg sudah tampil
 * di seluruh UI (Proses column, History) -- formReceived + start + finish
 * semua terisi.
 *
 * REVISI 2026-07-31 (menyusul file resmi "ALL FLOW PROSES.xlsx" dari user,
 * diimpor ke tabel MaterialFlow via menu Master Data > Material Flow
 * Proses): "tahap mana yg wajib utk Material X" SEKARANG dari MaterialFlow
 * (sumber kebenaran resmi), BUKAN lagi ditebak dari riwayat log. Ternyata
 * PALING BANYAK Material (55%) malah SKIP Premix & Milling total, bukan
 * cuma Aftermix/Colour Matching yg bisa di-skip spt asumsi versi pertama --
 * makanya SEMUA tahap (Premix/Milling/Aftermix/Colour Matching) sekarang
 * dicek "wajib atau tidak" lewat MaterialFlow, bukan cuma dua tahap
 * terakhir. QC & Approval & Packing TETAP logika lama (QC&Packing wajib
 * mutlak sesuai instruksi eksplisit user, dikonfirmasi jg oleh data: SEMUA
 * 2711 Material di file py QC+Packing terisi; Approval/Packing tetap gerbang
 * AdminQc, bukan MaterialFlow, krn itu keputusan administratif terpisah).
 *
 * Kalau Material belum ada di MaterialFlow sama sekali (belum sempat
 * diimpor/material baru), fallback ke heuristik lama (pernah ada histori
 * log di tahap itu) supaya tidak mendadak memblokir semua input utk Material
 * yg belum sempat terdaftar.
 */

async function latestPremix(order: string) {
  return prisma.premixAftermixLog.findFirst({
    where: { order, section: "PREMIX" },
    orderBy: { timestamp: "desc" },
    select: { formReceived: true, start: true, finish: true },
  });
}

async function latestAftermix(order: string) {
  return prisma.premixAftermixLog.findFirst({
    where: { order, section: "AFTERMIX" },
    orderBy: { timestamp: "desc" },
    select: { formReceived: true, start: true, finish: true },
  });
}

async function latestMilling(order: string) {
  return prisma.millingLog.findFirst({
    where: { order },
    orderBy: { timestamp: "desc" },
    select: { formReceived: true, start: true, finish: true },
  });
}

async function latestColourMatching(order: string) {
  return prisma.colourMatchingLog.findFirst({
    where: { order },
    orderBy: { timestamp: "desc" },
    select: { formReceived: true, start: true, finish: true },
  });
}

function isDn(row: { formReceived: Date | null; start: Date | null; finish: Date | null } | null): boolean {
  return Boolean(row?.formReceived && row?.start && row?.finish);
}

export async function isPremixDone(order: string): Promise<boolean> {
  return isDn(await latestPremix(order));
}

export async function isMillingDone(order: string): Promise<boolean> {
  return isDn(await latestMilling(order));
}

export async function isAftermixDone(order: string): Promise<boolean> {
  return isDn(await latestAftermix(order));
}

export async function isColourMatchingDone(order: string): Promise<boolean> {
  return isDn(await latestColourMatching(order));
}

/** Order-nya SUDAH masuk "List Antrian Approval" (AdminQc Stage terbaru
 * Approval/Joint Lot) -- gerbang wajib SEBELUM baris Approval baru boleh
 * dibuat, terpisah dari tier-validation internal Approval yg sudah ada. */
export async function hasAdminQcApprovalType(order: string): Promise<boolean> {
  const latest = await prisma.adminQc.findFirst({ where: { order }, orderBy: { timestamp: "desc" }, select: { typeLot: true } });
  return latest?.typeLot === "Approval" || latest?.typeLot === "Joint Lot";
}

type FlowStage = "premix" | "milling" | "aftermix" | "colourMatching";

const STAGE_LABEL: Record<FlowStage, string> = {
  premix: "Premix",
  milling: "Milling",
  aftermix: "Aftermix",
  colourMatching: "Colour Matching",
};

const STAGE_DONE_CHECK: Record<FlowStage, (order: string) => Promise<boolean>> = {
  premix: isPremixDone,
  milling: isMillingDone,
  aftermix: isAftermixDone,
  colourMatching: isColourMatchingDone,
};

/** Fallback lama (histori log) -- dipakai HANYA kalau Material belum
 * terdaftar sama sekali di MaterialFlow. Premix/Milling tidak punya
 * heuristik yg masuk akal (dulu dianggap selalu wajib), jadi default `true`
 * (aman/konservatif) utk keduanya. */
async function materialHasHistoryIn(stage: FlowStage, materialNumber: string): Promise<boolean> {
  if (stage === "premix" || stage === "milling") return true;
  if (stage === "aftermix") {
    return (await prisma.premixAftermixLog.count({ where: { materialNumber, section: "AFTERMIX" } })) > 0;
  }
  return (await prisma.colourMatchingLog.count({ where: { materialNumber } })) > 0;
}

/** Material ini WAJIB lewat tahap tsb? Sumber utama: MaterialFlow (file
 * resmi "ALL FLOW PROSES.xlsx"). Kalau Material belum terdaftar di sana,
 * fallback ke heuristik histori log lama. */
export async function isStageRequiredForMaterial(stage: FlowStage, materialNumber: string | null | undefined): Promise<boolean> {
  if (!materialNumber) return true; // tidak tahu Material-nya -- aman, anggap wajib
  const flow = await prisma.materialFlow.findUnique({ where: { materialNumber } });
  if (flow) {
    return {
      premix: flow.premixRequired,
      milling: flow.millingRequired,
      aftermix: flow.aftermixRequired,
      colourMatching: flow.colourMatchingRequired,
    }[stage];
  }
  return materialHasHistoryIn(stage, materialNumber);
}

/**
 * Cari prasyarat tahap `target`: tahap WAJIB terdekat sebelum `target` (dari
 * `candidatesNearestFirst`, sudah diurutkan dari yg paling dekat/terakhir ke
 * yg paling jauh/pertama) yg relevan utk Material ini. `null` kalau tidak
 * ada satupun tahap sebelumnya yg wajib (target = tahap pertama yg wajib
 * utk Material ini, boleh langsung diinput tanpa prasyarat).
 */
async function findRequiredPredecessor(
  materialNumber: string | null | undefined,
  candidatesNearestFirst: FlowStage[]
): Promise<FlowStage | null> {
  for (const candidate of candidatesNearestFirst) {
    if (await isStageRequiredForMaterial(candidate, materialNumber)) return candidate;
  }
  return null;
}

export interface StageGateResult {
  ok: boolean;
  missingStage?: string;
}

async function gateAgainst(
  order: string,
  materialNumber: string | null | undefined,
  candidatesNearestFirst: FlowStage[]
): Promise<StageGateResult> {
  const predecessor = await findRequiredPredecessor(materialNumber, candidatesNearestFirst);
  if (!predecessor) return { ok: true };
  const done = await STAGE_DONE_CHECK[predecessor](order);
  return { ok: done, missingStage: STAGE_LABEL[predecessor] };
}

/** Prasyarat Milling: Premix (kalau wajib utk Material ini). */
export function checkMillingGate(order: string, materialNumber: string | null | undefined): Promise<StageGateResult> {
  return gateAgainst(order, materialNumber, ["premix"]);
}

/** Prasyarat Aftermix: Milling, atau Premix kalau Milling di-skip utk Material ini. */
export function checkAftermixGate(order: string, materialNumber: string | null | undefined): Promise<StageGateResult> {
  return gateAgainst(order, materialNumber, ["milling", "premix"]);
}

/** Prasyarat Colour Matching: Aftermix, turun ke Milling, lalu Premix. */
export function checkColourMatchingGate(order: string, materialNumber: string | null | undefined): Promise<StageGateResult> {
  return gateAgainst(order, materialNumber, ["aftermix", "milling", "premix"]);
}

/** Prasyarat QC (2026-07-31, instruksi eksplisit user: QC wajib dilalui
 * SEMUA proses, tidak ada pengecualian) -- tahap produksi TERAKHIR yg
 * relevan utk Material ini (Colour Matching, turun ke Aftermix, Milling,
 * Premix) harus "-DN". */
export function checkQcGate(order: string, materialNumber: string | null | undefined): Promise<StageGateResult> {
  return gateAgainst(order, materialNumber, ["colourMatching", "aftermix", "milling", "premix"]);
}
