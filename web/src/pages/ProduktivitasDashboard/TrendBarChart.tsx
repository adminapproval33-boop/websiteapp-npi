import { useMemo, useRef, useState } from "react";
import type { TrendChartPoint, TrendSeries } from "./TrendLineChart";

const CHART_W = 900;
const CHART_H = 300;
const PAD = { top: 22, right: 16, bottom: 34, left: 52 };

/** Angka "bulat cantik" >= `n`. Langkahnya lebih halus drpd niceCeil di
 * TrendLineChart.tsx (yg cuma 1/2/5/10) -- di diagram batang, lompatan 2x
 * lipat bikin batang tertinggi cuma setengah tinggi plot & banyak ruang
 * kosong di atas (mis. nilai 228 -> batas 500). */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const frac = n / base;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find((s) => frac <= s + 1e-9) ?? 10) * base;
}

function dayOfWeek(bucketKey: string): number {
  const [y, m, d] = bucketKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Path batang dgn sudut ATAS membulat saja (dasar tetap rata di baseline). */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}

/**
 * Diagram batang per periode (2026-11-12, instruksi eksplisit user: grafik RFT
 * di Dashboard Produktivitas dibuat spt diagram batang di "Laporan Dashboard
 * Approval" -- lihat approvalReportSlide.ts: clustered column, angka nilai di
 * atas tiap batang, legenda, sumbu-Y mulai 0). Kerangka SVG/tooltip/toggle
 * tabel/arsir akhir pekan SAMA PERSIS dgn TrendLineChart.tsx supaya konsisten
 * dgn chart lain di halaman ini -- cuma mark-nya batang, bukan garis.
 */
export default function TrendBarChart({
  points,
  series,
  yAxisLabel,
  valueFormatter = (n) => n.toLocaleString("id-ID"),
  granularity,
  showAverage = false,
  showTable: controlledShowTable,
  yMax,
}: {
  points: TrendChartPoint[];
  series: TrendSeries[];
  yAxisLabel: string;
  valueFormatter?: (n: number) => string;
  granularity?: "day" | "week" | "month";
  /** Garis putus-putus rata-rata (cuma masuk akal utk 1 series). */
  showAverage?: boolean;
  /** Kontrol Tabel/Grafik dari luar -- sama semantiknya dgn TrendLineChart. */
  showTable?: boolean;
  /** Batas atas sumbu-Y tetap (mis. 100 utk persentase) -- kalau kosong,
   * dihitung otomatis dari nilai maksimum + ruang utk label angka. */
  yMax?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [internalShowTable, setInternalShowTable] = useState(false);
  const isTableControlled = controlledShowTable !== undefined;
  const showTable = isTableControlled ? controlledShowTable : internalShowTable;
  const svgRef = useRef<SVGSVGElement>(null);

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const maxValue = useMemo(() => {
    if (yMax) return yMax;
    let max = 0;
    for (const p of points) for (const s of series) max = Math.max(max, p.values[s.key] ?? 0);
    // +8% ruang di atas batang tertinggi supaya label angkanya tidak kepotong.
    return niceCeil((max || 1) * 1.08);
  }, [points, series, yMax]);

  const yFor = (v: number) => PAD.top + plotH - (Math.min(v, maxValue) / maxValue) * plotH;
  const groupW = points.length > 0 ? plotW / points.length : plotW;
  const groupX = (i: number) => PAD.left + i * groupW;
  // Lebar batang: 70% lebar grup dibagi jumlah series, celah 2px antar batang
  // (lihat skill dataviz: "2px surface gap between adjacent fills"), TAPI
  // dibatasi maks 56px/batang -- kalau bucket-nya cuma 2-3 (mis. Bulanan di
  // data yg masih muda), batang selebar sepertiga chart terlihat ganjil &
  // tidak mirip proporsi diagram batang di laporan Approval.
  const gap = series.length > 1 ? 2 : 0;
  const barW = Math.min(56, Math.max(2, (groupW * 0.7 - gap * (series.length - 1)) / series.length));
  const innerW = barW * series.length + gap * (series.length - 1);
  const showValueLabels = barW >= 16;

  // De-dupe: utk maxValue kecil (mis. 2, saat data belum termuat) pembulatan
  // bisa menghasilkan tick kembar (0,1,1,2,2) -> key React duplikat.
  const yTicks = Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxValue * f))));
  const xLabelStep = Math.max(1, Math.ceil(points.length / 12));

  const averages = useMemo(() => {
    if (!showAverage) return {};
    const out: Record<string, number> = {};
    for (const s of series) {
      const sum = points.reduce((acc, p) => acc + (p.values[s.key] ?? 0), 0);
      out[s.key] = points.length > 0 ? sum / points.length : 0;
    }
    return out;
  }, [points, series, showAverage]);

  function indexFromEvent(e: React.PointerEvent<SVGRectElement>): number | null {
    if (!svgRef.current || points.length === 0) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const idx = Math.floor((relX - PAD.left) / groupW);
    return Math.min(points.length - 1, Math.max(0, idx));
  }

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverCenterX = hoverIdx !== null ? groupX(hoverIdx) + groupW / 2 : null;
  const tooltipOnRight = hoverCenterX !== null && hoverCenterX < CHART_W * 0.62;

  if (points.length === 0) {
    return <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>Belum ada data pada rentang ini.</div>;
  }

  return (
    <div>
      {!isTableControlled && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button type="button" className="btn btn-outline" style={{ fontSize: "0.75rem", padding: "4px 10px" }} onClick={() => setInternalShowTable((s) => !s)}>
            {showTable ? "Lihat sbg Grafik" : "Lihat sbg Tabel"}
          </button>
        </div>
      )}

      {showTable ? (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>Periode</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.bucketKey}>
                  <td>{p.label}</td>
                  {series.map((s) => (
                    <td key={s.key}>{valueFormatter(p.values[s.key] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {/* Legenda -- selalu tampil utk >= 2 series (skill dataviz: identitas
              tidak boleh cuma dari warna; 1 series cukup judul panel). */}
          {series.length >= 2 && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: 2, fontSize: "0.75rem", color: "#64748b" }}>
              {series.map((s) => (
                <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
          <svg ref={svgRef} viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: "auto", display: "block", fontFamily: "inherit" }}>
            {yTicks.map((t) => {
              const y = yFor(t);
              return (
                <g key={t}>
                  <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y} y2={y} stroke="#e1e0d9" strokeWidth={1} />
                  <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#898781">
                    {t.toLocaleString("id-ID")}
                  </text>
                </g>
              );
            })}

            {granularity === "day" &&
              points.map((p, i) =>
                [0, 6].includes(dayOfWeek(p.bucketKey)) ? (
                  <rect key={`wknd-${p.bucketKey}`} x={groupX(i)} y={PAD.top} width={groupW} height={plotH} fill="#0b0b0b" fillOpacity={0.035} />
                ) : null
              )}

            {/* Sorot grup yg di-hover */}
            {hoverIdx !== null && <rect x={groupX(hoverIdx)} y={PAD.top} width={groupW} height={plotH} fill="#2a78d6" fillOpacity={0.06} />}

            {/* Batang -- flatMap (bukan map bersarang) supaya tiap elemen SVG
                ada di 1 array datar dgn key unik sendiri; array bersarang
                bikin React memberi key implisit per-index & memperingatkan
                "two children with the same key". */}
            {points.flatMap((p, i) => {
              const startX = groupX(i) + (groupW - innerW) / 2;
              return series.map((s, si) => {
                const v = p.values[s.key] ?? 0;
                const x = startX + si * (barW + gap);
                const y = yFor(v);
                const h = PAD.top + plotH - y;
                return (
                  <g key={`${p.bucketKey}-${s.key}`}>
                    {h > 0 && <path d={barPath(x, y, barW, h, 4)} fill={s.color} />}
                    {showValueLabels && v > 0 && (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1e293b">
                        {valueFormatter(v)}
                      </text>
                    )}
                  </g>
                );
              });
            })}

            {/* Label sumbu X */}
            {points.map((p, i) =>
              i % xLabelStep === 0 ? (
                <text key={p.bucketKey} x={groupX(i) + groupW / 2} y={CHART_H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="#898781">
                  {p.label}
                </text>
              ) : null
            )}

            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="#c3c2b7" strokeWidth={1} />

            {showAverage &&
              series.map((s) => {
                const avg = averages[s.key] ?? 0;
                const y = yFor(avg);
                return (
                  <g key={`avg-${s.key}`}>
                    <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y} y2={y} stroke="#1e293b" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.5} />
                    <text x={CHART_W - PAD.right} y={y - 5} textAnchor="end" fontSize={11} fontWeight={700} fill="#1e293b">
                      Rata-rata: {valueFormatter(avg)}
                    </text>
                  </g>
                );
              })}

            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={(e) => {
                const idx = indexFromEvent(e);
                if (idx !== null) setHoverIdx(idx);
              }}
              onPointerLeave={() => setHoverIdx(null)}
              style={{ cursor: "crosshair" }}
            />
          </svg>

          <div style={{ position: "absolute", top: series.length >= 2 ? 22 : 0, left: PAD.left, fontSize: "0.7rem", color: "var(--text-muted)" }}>{yAxisLabel}</div>

          {hoverPoint && hoverCenterX !== null && (
            <div
              style={{
                position: "absolute",
                top: 8,
                [tooltipOnRight ? "left" : "right"]: tooltipOnRight
                  ? `${(hoverCenterX / CHART_W) * 100 + 2}%`
                  : `${100 - (hoverCenterX / CHART_W) * 100 + 2}%`,
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                padding: "8px 10px",
                fontSize: "0.78rem",
                minWidth: 160,
                pointerEvents: "none",
                zIndex: 5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4, color: "#1e293b" }}>{hoverPoint.label}</div>
              {series.map((s) => (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ color: "#64748b", flex: 1 }}>{s.label}</span>
                  <span style={{ fontWeight: 700, color: "#1e293b" }}>{valueFormatter(hoverPoint.values[s.key] ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
