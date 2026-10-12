import fs from "fs";
import path from "path";
import PptxGenJS from "pptxgenjs";

const LOGO_PATH = path.join(__dirname, "../../../../web/public/brand-logo.png");
const NAVY = "1E2761";
const RED = "C0392B";
const AMBER = "C9975E";
const INK = "1F1B16";
const PAPER = "FFFDF9";
const MUTED = "8A7B68";

export interface StuckOrder {
  order: string;
  materialDescription: string | null;
  leadTimeProses: number;
  pctGR: string | null;
}

/** Bangun 1 file PPTX konsolidasi (semua tahap, semua order macet hari itu) --
 * dipakai sebagai lampiran yang SAMA utk semua penerima email Notifikasi Order
 * Macet (2026-10-12, instruksi eksplisit user: lampiran PPTX tidak
 * dipersonalisasi per tahap, berbeda dari body HTML email yang tetap
 * personalisasi per opt-in karyawan -- lihat orderDelayAlertScheduler.ts). */
export async function buildOrderDelayAlertPptx(
  ordersByStage: Map<string, StuckOrder[]>,
  thresholdDays: number,
  dateLabel: string
): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const logoData = fs.existsSync(LOGO_PATH)
    ? `image/png;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`
    : null;

  const stageCounts = [...ordersByStage.entries()]
    .map(([stage, orders]) => ({ stage, count: orders.length }))
    .sort((a, b) => b.count - a.count);

  const allOrders = [...ordersByStage.entries()]
    .flatMap(([stage, orders]) => orders.map((o) => ({ ...o, stage })))
    .sort((a, b) => b.leadTimeProses - a.leadTimeProses);

  // --- Slide 1: Ringkasan ---
  const summary = pres.addSlide();
  summary.background = { color: PAPER };
  if (logoData) {
    summary.addImage({ data: logoData, x: 0.4, y: 0.3, w: 1.8, h: 0.4 });
  }
  summary.addText(`Notifikasi Order Macet ≥ ${thresholdDays} Hari Kerja`, {
    x: 0.4,
    y: 0.85,
    w: 9,
    fontFace: "Calibri",
    fontSize: 26,
    bold: true,
    color: NAVY,
    isTextBox: true,
  });
  summary.addText(`Dihasilkan otomatis -- ${dateLabel}`, {
    x: 0.4,
    y: 1.35,
    w: 9,
    fontFace: "Calibri",
    fontSize: 13,
    color: MUTED,
    isTextBox: true,
  });

  summary.addText(String(allOrders.length), {
    x: 9.2,
    y: 0.3,
    w: 3.6,
    h: 0.9,
    fontFace: "Calibri",
    fontSize: 54,
    bold: true,
    color: RED,
    align: "right",
    isTextBox: true,
    margin: 0,
  });
  summary.addText("total order macet", {
    x: 9.2,
    y: 1.1,
    w: 3.6,
    fontFace: "Calibri",
    fontSize: 13,
    color: MUTED,
    align: "right",
    isTextBox: true,
    margin: 0,
  });

  if (stageCounts.length > 0) {
    summary.addChart(
      pres.ChartType.bar,
      [
        {
          name: "Order macet",
          labels: stageCounts.map((s) => s.stage),
          values: stageCounts.map((s) => s.count),
        },
      ],
      {
        x: 0.4,
        y: 1.9,
        w: 12.4,
        h: 5.2,
        barDir: "col",
        showTitle: true,
        title: `Jumlah Order Macet per Tahap (ambang ≥ ${thresholdDays} hari)`,
        titleFontFace: "Calibri",
        showLegend: false,
        showValue: true,
        dataLabelPosition: "outEnd",
        dataLabelColor: INK,
        dataLabelFontSize: 12,
        chartColors: [AMBER],
        catAxisLabelColor: INK,
        valAxisLabelColor: INK,
        catAxisLabelFontSize: 12,
        valAxisLabelFontSize: 11,
        valGridLine: { color: "E7DCC8", size: 1 },
        catGridLine: { style: "none" },
      }
    );
  }

  // --- Slide(s) 2+: Tabel detail, dipaginasi manual ~18 baris/slide ---
  const PAGE_SIZE = 18;
  const headerRow: PptxGenJS.TableRow = [
    { text: "Order", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
    { text: "Material", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
    { text: "Tahap Macet", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
    { text: "Lead Time (hari)", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" } },
    { text: "% GR", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" } },
  ];

  for (let i = 0; i < allOrders.length; i += PAGE_SIZE) {
    const chunk = allOrders.slice(i, i + PAGE_SIZE);
    const detail = pres.addSlide();
    detail.background = { color: PAPER };
    detail.addText(
      i === 0 ? "Detail Order Macet" : `Detail Order Macet (lanjutan, baris ${i + 1}-${i + chunk.length})`,
      { x: 0.4, y: 0.3, w: 12.4, fontFace: "Calibri", fontSize: 20, bold: true, color: NAVY, isTextBox: true }
    );

    const rows: PptxGenJS.TableRow[] = [
      headerRow,
      ...chunk.map((o) => {
        const severe = o.leadTimeProses >= thresholdDays * 1.5;
        const cellOpts = { color: severe ? RED : INK, bold: severe };
        return [
          { text: o.order, options: cellOpts },
          { text: o.materialDescription ?? "-", options: cellOpts },
          { text: o.stage, options: cellOpts },
          { text: String(o.leadTimeProses), options: { ...cellOpts, align: "right" as const } },
          { text: o.pctGR ?? "-", options: { ...cellOpts, align: "right" as const } },
        ];
      }),
    ];

    detail.addTable(rows, {
      x: 0.4,
      y: 0.9,
      w: 12.4,
      fontFace: "Calibri",
      fontSize: 12,
      border: { type: "solid", color: "E7DCC8", pt: 0.75 },
      autoPage: false,
    });
  }

  const buf = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  return buf;
}
