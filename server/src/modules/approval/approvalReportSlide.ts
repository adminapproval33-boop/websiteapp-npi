import fs from "fs";
import path from "path";
import PptxGenJS from "pptxgenjs";
import { fetchLotHistory } from "./approval.routes";

const NAVY = "1E2761";
const NAVY_DARK = "141B49";
const RED = "C0392B";
const YELLOW = "F1C40F";
const GREEN = "2ECC71";
const AMBER = "C9975E";
const INK = "1F1B16";
const PAPER = "FFFDF9";
const MUTED = "8A7B68";
const WHITE = "FFFFFF";
const ICE = "CADCFC";

const LOGO_PATH = path.join(__dirname, "../../../../web/public/brand-logo.png");

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// T1/T2/>T2 = jumlah percobaan sampai OK, dibaca dari penanda "T<angka>"
// tertinggi di kolom Remark (mis. "T1: NG ... T2: OK" = 2x percobaan).
// Remark kosong/tanpa penanda dianggap OK langsung (T1). SAMA PERSIS dgn
// logika yg dipakai manual utk "Laporan Dashboard Approval" (2026-10-13/16,
// instruksi eksplisit user: lampiran notifikasi Approval pakai format ini).
function maxTry(remark: string | null): number {
  if (!remark) return 1;
  const matches = [...remark.matchAll(/\bT\.?\s?([1-9])(?!\d)/gi)];
  if (matches.length === 0) return 1;
  return Math.max(...matches.map((m) => parseInt(m[1], 10)));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Gap Analysis & Action Plan -- narasi STATIS (2026-10-16, instruksi eksplisit
// user: chart di atas dihitung LIVE tiap hari, tapi narasi ini ditulis &
// di-update manual secara berkala, BUKAN digenerate otomatis -- analisis akar
// masalah per customer/NG butuh pembacaan manusia atas isi Remark, bukan
// sesuatu yg bisa disimpulkan otomatis oleh scheduler). Update terakhir:
// snapshot 13 Oktober 2026, dikirim ke Pak Jaya.
const STATIC_GAP_ANALYSIS: { seg: string; pct1st: number; gap: string; actions: string[] }[] = [
  {
    seg: "AUTOMOTIVE",
    pct1st: 95.5,
    gap: "190 of 199 orders (95.5%) were approved on the first attempt. 9 orders required improvement, mostly from Astra Daihatsu Motor (4 orders: too dark, too light, too blue — 3 different lots) and Kramayudha Ratu Motor (2 orders: recurring “color and Doi” issue).",
    actions: [
      "Review the color panel standard with the Tech PIC for Astra Daihatsu Motor — 3 lots failed in 3 different color directions (too dark/too light/too blue), suggesting the color reference needs to be aligned across lots.",
      "Follow up directly with Kramayudha Ratu Motor — the recurring “color and Doi” issue (2x) suggests the root cause was not resolved on the first attempt.",
      "Use the 190 first-attempt-OK orders as a best-practice benchmark for the submission process in other segments.",
    ],
  },
  {
    seg: "MOTORCYCLE",
    pct1st: 92.6,
    gap: "87 of 94 orders (92.6%) were approved on the first attempt. 7 orders required improvement, mostly from Yamaha Indonesia Motor Manufacturing (3 orders: too light, peeloff, too dark — inconsistent failure direction) and Sanly (2 orders: color not matching the master color).",
    actions: [
      "Recalibrate the color target for Yamaha IMM — opposite failure directions (too light vs. too dark) across different lots suggest the color tolerance needs adjusting, not just human error.",
      "Verify alignment on the master color with Sanly before the next submission, to prevent the 2 “color mismatch” cases from recurring.",
      "Coordinate with the production team on the peeloff case (an adhesion issue, not color) — check application/curing parameters before the next lot is submitted.",
    ],
  },
  {
    seg: "GIU",
    pct1st: 100,
    gap: "All 42 orders were approved on the first attempt, with no revisions at all.",
    actions: [
      "Maintain the current process controls — a 100% first-attempt approval rate shows the process is already optimal.",
      "Document GIU’s good practices as a reference for raising the first-attempt approval rate in Automotive & Motorcycle.",
    ],
  },
];
const GAP_ANALYSIS_ASOF = "October 13, 2026 (snapshot sent to Pak Jaya)";

function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function bulletCell(items: string[], color: string) {
  return items.map((text, i) => ({
    text,
    options: { bullet: { code: "25CF", indent: 10 }, color, breakLine: i < items.length - 1 },
  }));
}

/** Generate "Laporan Dashboard Approval" (format EN, sama dgn yg dikirim ke
 * Pak Jaya) -- dipakai sbg lampiran KHUSUS notifikasi Order Macet utk
 * penerima yg opt-in tahap Approval (2026-10-16, instruksi eksplisit user).
 * Chart dihitung LIVE dari ApprovalSchedule tiap kali dipanggil; slide Gap
 * Analysis & Action Plan pakai teks statis (lihat komentar di atas). */
export async function buildApprovalReportPptx(): Promise<Buffer> {
  const rows = await fetchLotHistory("", "", "");
  const closed = rows.filter((r) => r.status === "Oke Approval" && r.finishApp);

  const today = new Date();
  const currentYear = today.getUTCFullYear();

  const bySegMonth = new Map<string, Map<string, { T1: number; T2: number; over: number }>>();
  for (const r of closed) {
    const seg = (r.custSegmen ?? "").trim();
    if (!seg) continue;
    const mk = monthKey(r.finishApp as Date);
    if (!mk.startsWith(`${currentYear}-`)) continue; // Ytd tahun berjalan saja
    const n = maxTry(r.remark);
    const bucket = n <= 1 ? "T1" : n === 2 ? "T2" : "over";
    if (!bySegMonth.has(seg)) bySegMonth.set(seg, new Map());
    const segMap = bySegMonth.get(seg)!;
    if (!segMap.has(mk)) segMap.set(mk, { T1: 0, T2: 0, over: 0 });
    segMap.get(mk)![bucket]++;
  }

  const segments = Array.from(bySegMonth.keys()).sort();

  // Rentang bulan sumbu-X: dari bulan data REAL paling awal tahun ini, s/d
  // Desember tahun berjalan (bulan yg belum terjadi = 0, placeholder --
  // 2026-10-13, instruksi eksplisit Pak Jaya: "biar ada Sept Oct Nov Dec nya
  // utk trend analysis", 2026-10-16 digeneralkan jadi hitung sendiri per
  // tahun berjalan, bukan hardcode). Ytd.<YY> = total semua bulan real tahun
  // ini.
  let earliestMonthIdx = 11;
  for (const segMap of bySegMonth.values()) {
    for (const mk of segMap.keys()) {
      const idx = parseInt(mk.split("-")[1], 10) - 1;
      if (idx < earliestMonthIdx) earliestMonthIdx = idx;
    }
  }
  if (earliestMonthIdx === 11 && bySegMonth.size === 0) earliestMonthIdx = today.getUTCMonth();
  const monthIdxRange: number[] = [];
  for (let i = earliestMonthIdx; i <= 11; i++) monthIdxRange.push(i);
  const ytdLabel = `Ytd.${String(currentYear).slice(-2)}`;
  const monthLabels = [...monthIdxRange.map((i) => MONTH_ABBR[i]), ytdLabel];

  function seriesFor(seg: string) {
    const segMap = bySegMonth.get(seg) ?? new Map();
    const values = { T1: [] as number[], T2: [] as number[], over: [] as number[] };
    const ytd = { T1: 0, T2: 0, over: 0 };
    for (const idx of monthIdxRange) {
      const mk = `${currentYear}-${String(idx + 1).padStart(2, "0")}`;
      const bucket = segMap.get(mk) ?? { T1: 0, T2: 0, over: 0 };
      values.T1.push(bucket.T1);
      values.T2.push(bucket.T2);
      values.over.push(bucket.over);
      ytd.T1 += bucket.T1;
      ytd.T2 += bucket.T2;
      ytd.over += bucket.over;
    }
    values.T1.push(ytd.T1);
    values.T2.push(ytd.T2);
    values.over.push(ytd.over);
    return { values, total: ytd.T1 + ytd.T2 + ytd.over };
  }

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "MES NPI";
  pres.title = "Approval Dashboard Report";

  const logoData = fs.existsSync(LOGO_PATH)
    ? `image/png;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`
    : null;
  const snapshotLabel = `${today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} (auto-generated)`;

  // ---------------- Slide 1: Cover ----------------
  const cover = pres.addSlide();
  cover.background = { color: NAVY_DARK };
  if (logoData) cover.addImage({ data: logoData, x: 0.6, y: 0.5, w: 2.2, h: 0.49 });
  cover.addText("REPORT", {
    x: 0.8, y: 2.4, w: 11.7, fontFace: "Calibri", fontSize: 20, bold: true,
    color: AMBER, charSpacing: 4, isTextBox: true, margin: 0,
  });
  cover.addText("Approval Dashboard", {
    x: 0.8, y: 2.85, w: 11.7, fontFace: "Cambria", fontSize: 48, bold: true,
    color: WHITE, isTextBox: true, margin: 0,
  });
  cover.addText("Summary of open approval status, approval performance by segment, and PIC workload", {
    x: 0.8, y: 3.75, w: 10.5, fontFace: "Calibri", fontSize: 18, color: ICE, isTextBox: true, margin: 0,
  });
  cover.addText(
    [
      { text: "Snapshot: ", options: { color: MUTED } },
      { text: snapshotLabel, options: { color: ICE, bold: true } },
    ],
    { x: 0.8, y: 6.7, w: 10, fontFace: "Calibri", fontSize: 13, isTextBox: true, margin: 0 }
  );
  cover.addText("Source: mes.nipseapaint.com:8090/dashboard/approval", {
    x: 0.8, y: 7.0, w: 10, fontFace: "Calibri", fontSize: 11, color: MUTED, isTextBox: true, margin: 0,
  });

  // ---------------- Slide 2: Hasil Approval per Segmen (LIVE) ----------------
  const s2 = pres.addSlide();
  s2.background = { color: PAPER };
  s2.addText("Approval Results by Customer Segment", {
    x: 0.5, y: 0.3, w: 12.3, fontFace: "Cambria", fontSize: 24, bold: true, color: NAVY, isTextBox: true, margin: 0,
  });
  s2.addText(
    `Number of attempts until OK, by month (side-by-side bars) — ${fmtNum(closed.length)} closed orders (Oke Approval) out of ${fmtNum(rows.length)} total open orders.`,
    { x: 0.5, y: 0.82, w: 12.3, fontFace: "Calibri", fontSize: 11.5, color: MUTED, isTextBox: true, margin: 0 }
  );

  const legendT = ["T1 (OK on 1st try)", "T2 (2 tries)", ">T2 (>2 tries)"];
  const legendColors = [GREEN, YELLOW, RED];
  let legendX = 0.5;
  legendT.forEach((label, i) => {
    s2.addShape(pres.ShapeType.rect, { x: legendX, y: 1.28, w: 0.16, h: 0.16, fill: { color: legendColors[i] }, line: { type: "none" } });
    s2.addText(label, { x: legendX + 0.22, y: 1.19, w: 2.5, fontFace: "Calibri", fontSize: 10.5, color: INK, isTextBox: true, margin: 0 });
    legendX += 2.5;
  });

  const panelCount = Math.max(segments.length, 1);
  const totalGapWidth = 0.27 * (panelCount - 1);
  const chartW = (12.3 - totalGapWidth) / panelCount;
  const chartXs = segments.map((_, i) => 0.5 + i * (chartW + 0.27));

  segments.forEach((seg, i) => {
    const { values, total } = seriesFor(seg);
    s2.addText(seg, {
      x: chartXs[i], y: 1.58, w: chartW, fontFace: "Calibri", fontSize: 14, bold: true, color: NAVY,
      align: "center", isTextBox: true, margin: 0,
    });
    s2.addText(`${fmtNum(total)} orders (${ytdLabel})`, {
      x: chartXs[i], y: 1.87, w: chartW, fontFace: "Calibri", fontSize: 10, color: MUTED,
      align: "center", isTextBox: true, margin: 0,
    });
    s2.addChart(
      pres.ChartType.bar,
      [
        { name: "T1", labels: monthLabels, values: values.T1 },
        { name: "T2", labels: monthLabels, values: values.T2 },
        { name: ">T2", labels: monthLabels, values: values.over },
      ],
      {
        x: chartXs[i], y: 2.2, w: chartW, h: 2.65,
        barDir: "col", barGrouping: "clustered",
        showTitle: false, showLegend: false,
        showValue: true, dataLabelPosition: "outEnd",
        dataLabelColor: INK, dataLabelFontSize: 7, dataLabelFontFace: "Calibri", dataLabelFontBold: true,
        chartColors: [GREEN, YELLOW, RED],
        catAxisLabelColor: INK, valAxisLabelColor: INK,
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 8,
        catAxisLabelFontFace: "Calibri", valAxisLabelFontFace: "Calibri",
        valGridLine: { color: "E7DCC8", size: 1 }, catGridLine: { style: "none" },
        valAxisMinVal: 0,
      }
    );
  });

  s2.addText(
    `Methodology: T1/T2/>T2 are calculated from orders with “Oke Approval” status (closed), grouped by Finish App month, based on the highest “T<number>” marker in the Remark column. Future months in ${currentYear} show 0 (not yet occurred as of this snapshot) and will fill in automatically as each month passes. ${ytdLabel} = year-to-date total.`,
    { x: 0.5, y: 7.0, w: 12.3, fontFace: "Calibri", fontSize: 8.5, italic: true, color: MUTED, isTextBox: true, margin: 0 }
  );

  // ---------------- Slide 3: Gap Analysis & Action Plan (statis) ----------------
  const s3 = pres.addSlide();
  s3.background = { color: PAPER };
  s3.addText("Gap Analysis & Action Plan by Segment", {
    x: 0.5, y: 0.35, w: 12.3, fontFace: "Cambria", fontSize: 26, bold: true, color: NAVY, isTextBox: true, margin: 0,
  });
  s3.addText(
    `Note: this analysis is written manually and updated periodically, NOT regenerated automatically — last updated as of ${GAP_ANALYSIS_ASOF}. It may lag behind the live chart above.`,
    { x: 0.5, y: 0.9, w: 12.3, fontFace: "Calibri", fontSize: 12, italic: true, color: MUTED, isTextBox: true, margin: 0 }
  );

  const gapHeader = [
    { text: "Segment", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "% 1st Approval", options: { bold: true, color: WHITE, fill: { color: NAVY }, align: "right" as const } },
    { text: "Gap Analysis", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "Action Plan", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ];
  const gapRows = STATIC_GAP_ANALYSIS.map((d) => [
    { text: d.seg, options: { color: INK, bold: true, valign: "top" as const } },
    { text: `${d.pct1st.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`, options: { color: d.pct1st >= 95 ? GREEN : INK, bold: true, align: "right" as const, valign: "top" as const } },
    { text: d.gap, options: { color: INK, valign: "top" as const } },
    { text: bulletCell(d.actions, NAVY), options: { valign: "top" as const } },
  ]);
  s3.addTable([gapHeader, ...gapRows], {
    x: 0.5, y: 1.4, w: 12.3, colW: [1.2, 1.1, 4.5, 5.5],
    fontFace: "Calibri", fontSize: 10.5,
    border: { type: "solid", color: "E7DCC8", pt: 0.75 },
    autoPage: false,
    valign: "top",
  });

  s3.addText(`MES NPI — Approval Dashboard • Snapshot ${snapshotLabel}`, {
    x: 0.5, y: 7.15, w: 12.3, fontFace: "Calibri", fontSize: 10, color: MUTED, isTextBox: true, margin: 0,
  });

  const buf = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  return buf;
}
