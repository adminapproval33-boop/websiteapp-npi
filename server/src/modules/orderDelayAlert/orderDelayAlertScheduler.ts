import { prisma } from "../../lib/prisma";
import { sendMail } from "../../lib/mailer";
import { getProductionOrderRows, ProductionOrderRow } from "../dashboard/dashboard.routes";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cek tiap 15 menit -- sama pola dgn backupScheduler.ts.

/** Jam (0-23, waktu server) dijalankannya pengecekan & pengiriman harian --
 * KONSTANTA TETAP (2026-10-01, revisi ke-3 instruksi eksplisit user:
 * "Pengaturan Sistem hilangkan saja, masukkan semuanya ke menu Notifikasi,
 * agar user bisa mandiri setting sendiri") -- sudah tidak ada lagi menu admin
 * terpisah utk ini; scheduler otomatis jalan tiap hari begitu ada user yg
 * opt-in sendiri lewat Settings > Notifikasi, tidak ada saklar aktif/nonaktif
 * sistem lagi. */
const CHECK_HOUR = 7;

/** Tahap proses (nama persis dari computeStages() di dashboard.routes.ts) ->
 * field toggle personal di MasterEmployee (2026-10-01, instruksi eksplisit
 * user, revisi ke-2: opt-in PER TAHAP milik masing-masing user sendiri, lepas
 * dari departemen -- bukan lagi pemetaan tahap->departemen admin). "Packing"
 * sengaja tidak ada di sini -- di luar cakupan fitur ini. */
const STAGE_NOTIFY_FIELD: Record<string, keyof StageNotifyFields | undefined> = {
  Premix: "notifyPremix",
  Milling: "notifyMilling",
  Aftermix: "notifyAftermix",
  "Colour Matching": "notifyColourMatching",
  QC: "notifyQc",
  Approval: "notifyApproval",
};

interface StageNotifyFields {
  notifyPremix: boolean;
  notifyMilling: boolean;
  notifyAftermix: boolean;
  notifyColourMatching: boolean;
  notifyQc: boolean;
  notifyApproval: boolean;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, waktu server
}

/** Tahap yg sedang macet utk 1 order = elemen PERTAMA di `stages` dgn
 * `done: false` (urutan `stages` sudah sesuai alur proses, lihat
 * computeStages()). null kalau semua tahap yg relevan sudah selesai, atau
 * kalau tahap yg macet itu "Packing" (di luar cakupan fitur ini). */
function currentStuckStage(row: ProductionOrderRow): string | null {
  const stuck = row.stages.find((s) => !s.done);
  if (!stuck || stuck.name === "Packing") return null;
  return stuck.name;
}

function digestHtml(orders: { order: string; materialDescription: string | null; stage: string; leadTimeProses: number }[]) {
  const rows = orders
    .map(
      (o) =>
        `<tr><td style="padding:4px 10px;border:1px solid #ddd;">${o.order}</td><td style="padding:4px 10px;border:1px solid #ddd;">${
          o.materialDescription ?? "-"
        }</td><td style="padding:4px 10px;border:1px solid #ddd;">${o.stage}</td><td style="padding:4px 10px;border:1px solid #ddd;text-align:right;">${
          o.leadTimeProses
        } hari</td></tr>`
    )
    .join("");
  return `
    <p>Order berikut sudah macet melebihi ambang batas Lead Time Proses yang Anda tentukan, di tahap yang Anda ikuti notifikasinya:</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;">
      <thead><tr>
        <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Order</th>
        <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Material</th>
        <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Tahap Macet</th>
        <th style="padding:4px 10px;border:1px solid #ddd;text-align:right;">Lead Time Proses</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;color:#666;font-size:12px;">Email otomatis dari MES NPI -- dashboard Production Order Monitoring. Atur preferensi ini lewat Settings &gt; Notifikasi.</p>
  `;
}

async function runOrderDelayAlertCheck() {
  const now = new Date();
  if (now.getHours() !== CHECK_HOUR) return;

  const alreadyRanToday = await prisma.orderDelayAlertEvent.findFirst({
    where: { createdAt: { gte: new Date(`${todayKey()}T00:00:00`) } },
  });
  if (alreadyRanToday) return;

  try {
    const rows = await getProductionOrderRows();

    // Kelompokkan order per tahap macetnya dulu (lepas dari threshold siapa
    // pun -- ambang hari sekarang personal per karyawan, bukan 1 nilai global).
    const ordersByStage = new Map<string, { order: string; materialDescription: string | null; leadTimeProses: number }[]>();
    for (const r of rows) {
      if (r.leadTimeProses === null) continue;
      const stage = currentStuckStage(r);
      if (!stage || !STAGE_NOTIFY_FIELD[stage]) continue;
      const list = ordersByStage.get(stage) ?? [];
      list.push({ order: r.order, materialDescription: r.materialDescription, leadTimeProses: r.leadTimeProses });
      ordersByStage.set(stage, list);
    }

    // Penerima = SIAPA SAJA yg sudah isi email, dicek per tahap yg dia
    // aktifkan sendiri + ambang hari personalnya sendiri (2026-10-01, revisi
    // ke-2 eksplisit user: "kalau user tersebut memilih untuk menyalakan
    // notifikasi Approval, maka user tersebut akan menerima email notifikasi
    // approval yang lead time prosesnya >=20 hari" -- 20 cuma contoh, angka
    // aslinya dari notifyThresholdDays milik user ybs).
    const employees = await prisma.masterEmployee.findMany({
      where: { email: { not: null } },
      select: {
        email: true,
        notifyThresholdDays: true,
        notifyPremix: true,
        notifyMilling: true,
        notifyAftermix: true,
        notifyColourMatching: true,
        notifyQc: true,
        notifyApproval: true,
      },
    });

    let recipientsNotified = 0;
    const involvedOrders = new Set<string>();
    for (const emp of employees) {
      const matched: { order: string; materialDescription: string | null; stage: string; leadTimeProses: number }[] = [];
      for (const [stage, field] of Object.entries(STAGE_NOTIFY_FIELD)) {
        if (!field || !emp[field]) continue;
        const list = ordersByStage.get(stage) ?? [];
        for (const o of list) {
          if (o.leadTimeProses >= emp.notifyThresholdDays) matched.push({ ...o, stage });
        }
      }
      if (matched.length === 0) continue;
      await sendMail({
        to: [emp.email!],
        subject: `[MES NPI] ${matched.length} Order macet >= ${emp.notifyThresholdDays} hari kerja`,
        html: digestHtml(matched),
      });
      recipientsNotified++;
      matched.forEach((m) => involvedOrders.add(m.order));
    }

    await prisma.orderDelayAlertEvent.create({
      data: { ordersFlagged: involvedOrders.size, recipientsNotified },
    });
  } catch (err) {
    console.error("[order-delay-alert] Pengecekan/pengiriman Notifikasi Order Macet harian gagal:", err);
  }
}

export function startOrderDelayAlertScheduler() {
  runOrderDelayAlertCheck().catch((err) => console.error("[order-delay-alert] Pengecekan awal gagal:", err));
  setInterval(() => {
    runOrderDelayAlertCheck().catch((err) => console.error("[order-delay-alert] Pengecekan gagal:", err));
  }, CHECK_INTERVAL_MS);
}
