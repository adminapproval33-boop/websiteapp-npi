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

const FONT_BODY = `Calibri`;
const FONT_HEAD = `Cambria`;
const BAR_COL = `col`;
const BAR_CLUSTERED = `clustered`;
const LEGEND_RIGHT = `r`;
const LABEL_OUTEND = `outEnd`;
const GRID_COLOR = `E7DCC8`;
const GRID_NONE = `none`;
const PROC_TITLE = `Processing Time by Submit-to-Customer Month Cohort (current age status)`;
const PROC_METHOD_PREFIX = `Methodology: `;
const SOURCE_LABEL = `Source: mes.nipseapaint.com:8090/dashboard/approval`;
const GAP_TITLE = `Gap Analysis & Action Plan by Segment`;

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

// Bucket umur "hari sejak submit" -- SAMA PERSIS dgn AGE_BUCKETS/bucketOf di
// OpenApprovalWorklist.tsx (kartu KPI "Lama Proses" dashboard Approval).
const AGE_BUCKETS = [
  { key: "1-7", color: "27AE60" },
  { key: "8-14", color: "58D68D" },
  { key: "15-21", color: AMBER },
  { key: "21-30", color: "E67E22" },
  { key: ">30", color: "922B21" },
] as const;
type AgeBucketKey = (typeof AGE_BUCKETS)[number]["key"];
function bucketOfDays(days: number): AgeBucketKey {
  if (days <= 7) return "1-7";
  if (days <= 14) return "8-14";
  if (days <= 21) return "15-21";
  if (days <= 30) return "21-30";
  return ">30";
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

  // Processing Time: utk tiap KOHORT bulan Submit Cust, distribusi umur SAAT
  // INI (hari sejak submit, metodologi SAMA PERSIS dgn kartu "Lama Proses" di
  // dashboard Approval) -- dihitung dari SEMUA order (bukan cuma yg closed),
  // sama seperti kartu KPI aslinya.
  const now = Date.now();
  const byCohortMonth = new Map<string, Record<AgeBucketKey, number>>();
  for (const r of rows) {
    const startIso = r.submitToCustomer ?? r.timestamp;
    if (!startIso) continue;
    const mk = monthKey(startIso as Date);
    if (!mk.startsWith(`${currentYear}-`)) continue;
    const days = Math.max(0, Math.floor((now - (startIso as Date).getTime()) / 86400000));
    const bucket = bucketOfDays(days);
    if (!byCohortMonth.has(mk)) byCohortMonth.set(mk, { "1-7": 0, "8-14": 0, "15-21": 0, "21-30": 0, ">30": 0 });
    byCohortMonth.get(mk)![bucket]++;
  }
  function cohortSeriesFor(bucketKey: AgeBucketKey): number[] {
    const values = monthIdxRange.map((idx) => {
      const mk = `${currentYear}-${String(idx + 1).padStart(2, "0")}`;
      return byCohortMonth.get(mk)?.[bucketKey] ?? 0;
    });
    const ytd = values.reduce((a, b) => a + b, 0);
    return [...values, ytd];
  }

  // Diurutkan berdasar total order TERBANYAK dulu (bukan alfabet) -- sama
  // dgn urutan di file referensi (2026-10-16, instruksi eksplisit user:
  // samakan formatnya).
  const segments = Array.from(bySegMonth.keys()).sort((a, b) => seriesFor(b).total - seriesFor(a).total);

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

  // Layout: 3 chart full-width ditumpuk VERTIKAL (bukan 3 panel berdampingan)
  // + legend vertikal di kanan, sejajar chart tengah -- sama persis dgn
  // referensi (2026-10-16, instruksi eksplisit user: samakan formatnya).
  // Posisi diambil dari koordinat EMU file referensi (dikonversi ke inch,
  // 1in = 914400 EMU).
  const CHART_X = 0.5;
  const CHART_W = 11.3;
  const CHART_H = 1.55;
  const ROW_GAP = 1.86;
  const FIRST_ROW_Y = 1.15;
  const SERIES_T1 = `T1`;
  const SERIES_T2 = `T2`;
  const SERIES_OVER = `>T2`;
  const ALIGN_CENTER = `center`;

  segments.forEach((seg, i) => {
    const { values, total } = seriesFor(seg);
    const rowY = FIRST_ROW_Y + i * ROW_GAP;
    s2.addText(
      [
        { text: seg, options: { color: NAVY, bold: true } },
        { text: `   ${fmtNum(total)} orders (${ytdLabel})`, options: { color: MUTED, bold: true } },
      ],
      { x: CHART_X, y: rowY, w: CHART_W, fontFace: FONT_BODY, fontSize: 14, align: ALIGN_CENTER, isTextBox: true, margin: 0 }
    );
    s2.addChart(
      pres.ChartType.bar,
      [
        { name: SERIES_T1, labels: monthLabels, values: values.T1 },
        { name: SERIES_T2, labels: monthLabels, values: values.T2 },
        { name: SERIES_OVER, labels: monthLabels, values: values.over },
      ],
      {
        x: CHART_X, y: rowY + 0.25, w: CHART_W, h: CHART_H,
        barDir: BAR_COL, barGrouping: BAR_CLUSTERED,
        showTitle: false, showLegend: false,
        showValue: true, dataLabelPosition: LABEL_OUTEND,
        dataLabelColor: INK, dataLabelFontSize: 7, dataLabelFontFace: FONT_BODY, dataLabelFontBold: true,
        chartColors: [GREEN, YELLOW, RED],
        catAxisLabelColor: INK, valAxisLabelColor: INK,
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 8,
        catAxisLabelFontFace: FONT_BODY, valAxisLabelFontFace: FONT_BODY,
        valGridLine: { color: GRID_COLOR, size: 1 }, catGridLine: { style: GRID_NONE },
        valAxisMinVal: 0,
      }
    );
  });

  // Legend vertikal di kanan, sejajar baris tengah (2nd chart) -- sama posisi
  // relatif dgn file referensi.
  const legendLabel1 = `T1 (OK on 1st try)`;
  const legendLabel2 = `T2 (2 tries)`;
  const legendLabel3 = `>T2 (>2 tries)`;
  const legendT = [legendLabel1, legendLabel2, legendLabel3];
  const legendColors = [GREEN, YELLOW, RED];
  const legendBaseY = FIRST_ROW_Y + ROW_GAP + 0.65;
  legendT.forEach((label, i) => {
    const y = legendBaseY + i * 0.27;
    s2.addShape(pres.ShapeType.rect, { x: 11.9, y, w: 0.16, h: 0.16, fill: { color: legendColors[i] }, line: { type: GRID_NONE } });
    s2.addText(label, { x: 12.1, y: y - 0.03, w: 1.2, fontFace: FONT_BODY, fontSize: 10.5, bold: true, color: INK, isTextBox: true, margin: 0 });
  });

  // ---------------- Slide 3: Processing Time by Submit-to-Customer Month Cohort (LIVE) ----------------
  const s3Proc = pres.addSlide();
  s3Proc.background = { color: PAPER };
  s3Proc.addText(PROC_TITLE, {
    x: 0.5, y: 0.35, w: 12.3, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: NAVY, isTextBox: true, margin: 0,
  });
  s3Proc.addChart(
    pres.ChartType.bar,
    AGE_BUCKETS.map((b) => ({ name: b.key, labels: monthLabels, values: cohortSeriesFor(b.key) })),
    {
      x: 0.5, y: 1.1, w: 12.3, h: 5.3,
      barDir: BAR_COL, barGrouping: BAR_CLUSTERED,
      showTitle: false,
      showLegend: true, legendPos: LEGEND_RIGHT, legendFontFace: FONT_BODY, legendFontSize: 10, legendColor: INK,
      showValue: true, dataLabelPosition: LABEL_OUTEND,
      dataLabelColor: INK, dataLabelFontSize: 9, dataLabelFontFace: FONT_BODY,
      chartColors: AGE_BUCKETS.map((b) => b.color),
      catAxisLabelColor: INK, valAxisLabelColor: INK,
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 9,
      catAxisLabelFontFace: FONT_BODY, valAxisLabelFontFace: FONT_BODY,
      valGridLine: { color: GRID_COLOR, size: 1 }, catGridLine: { style: GRID_NONE },
      valAxisMinVal: 0,
    }
  );
  s3Proc.addText(
    PROC_METHOD_PREFIX + `grouped by the month each order was submitted to the customer; bars show that cohort's CURRENT age distribution (days since submit, as of this snapshot) -- same methodology as the “Processing Time” cards on the Approval dashboard. ${ytdLabel} = year-to-date total.`,
    { x: 0.5, y: 6.55, w: 12.3, fontFace: FONT_BODY, fontSize: 9.5, italic: true, color: MUTED, isTextBox: true, margin: 0 }
  );
  s3Proc.addText(SOURCE_LABEL, {
    x: 0.5, y: 7.1, w: 12.3, fontFace: FONT_BODY, fontSize: 10, color: MUTED, isTextBox: true, margin: 0,
  });

  // ---------------- Slide 4: Gap Analysis & Action Plan (statis) ----------------
  const s3 = pres.addSlide();
  s3.background = { color: PAPER };
  s3.addText(GAP_TITLE, {
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
