import { prisma } from "./prisma";
import { isValidTankCode } from "./tankCode";

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
 * dari modul lain yg cuma 1) -- digabung jadi satu string "A / B".
 *
 * Dipindah ke sini (2026-08-20) dari productionLabel.routes.ts supaya bisa
 * dipakai ulang oleh productionLabelFg.routes.ts (Label Entry FG) -- logika
 * lintas-modul ini generik, tidak beda antara SFG/FG. */
export async function getLatestCrossModule(order: string) {
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
export async function isValidTankCodeOrJoined(value: string): Promise<boolean> {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parts = trimmed.split(" / ").map((p) => p.trim());
  const results = await Promise.all(parts.map((p) => isValidTankCode(p)));
  return results.every(Boolean);
}
