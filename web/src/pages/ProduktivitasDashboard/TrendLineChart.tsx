import { useMemo, useRef, useState } from "react";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

export interface TrendChartPoint {
  bucketKey: string;
  label: string;
  values: Record<string, number>;
}

const CHART_W = 900;
const CHART_H = 300;
const PAD = { top: 16, right: 16, bottom: 34, left: 52 };

/** Angka "bulat cantik" >= `n` (0/1/2/5 x 10^k) -- dipakai utk batas atas
 * sumbu Y supaya gridline jatuh di angka rapi, bukan pecahan aneh. */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const frac = n / base;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * base;
}

/** 0=Minggu, 6=Sabtu -- parse manual dari `bucketKey` ("YYYY-MM-DD", kalender
 * WIB dari backend), pakai `Date.UTC` murni utk aritmetika kalender (BUKAN
 * konversi timezone lokal browser). */
function dayOfWeek(bucketKey: string): number {
  const [y, m, d] = bucketKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Line chart tren produktivitas (2026-08-21, instruksi eksplisit user):
 * "berapa rata-rata formula yang dibuat per hari/minggu/bulan", supaya
 * gampang kelihatan tren naik/turun. SVG polos (project ini belum pakai
 * library chart apa pun) -- 2px line per tahap, hover crosshair + tooltip
 * satu baris per tahap, legend selalu tampil (>=2 series), toggle "Lihat
 * sbg Tabel" utk pembaca yg kesulitan bedakan warna (lihat skill dataviz:
 * beberapa warna kategori di bawah 3:1 kontras vs surface putih -- relief
 * rule-nya legend + table view, BUKAN warna teks).
 */
export default function TrendLineChart({
  points,
  series,
  yAxisLabel,
  valueFormatter = (n) => n.toLocaleString("id-ID"),
  granularity,
  showAverage = false,
  onPointClick,
  showTable: controlledShowTable,
}: {
  points: TrendChartPoint[];
  series: TrendSeries[];
  yAxisLabel: string;
  valueFormatter?: (n: number) => string;
  /** Kalau "day", akhir pekan (Sabtu/Minggu) ditandai garis pembatas + area
   * abu-abu tipis (2026-08-21, instruksi eksplisit user) -- granularitas
   * Mingguan/Bulanan tidak py resolusi per-hari jadi tidak berlaku. */
  granularity?: "day" | "week" | "month";
  /** Garis putus-putus rata-rata per series, dgn label nilainya di ujung
   * kanan (2026-08-21, instruksi eksplisit user: "rata-rata pendapatan
   * output produksi" di grafik per-proses). Dibiarkan opsional (default off)
   * krn di grafik gabungan 5-series garis rata-rata x5 bakal penuh sesak --
   * cuma dipakai saat `series` isinya 1 tahap. */
  showAverage?: boolean;
  /** Klik titik pada grafik -> pop-up breakdown (2026-08-25, instruksi
   * eksplisit user: lihat IU Plant per tahap pada hari/minggu/bulan
   * tertentu). Opsional -- kalau diisi, kursor jadi "pointer" (bukan
   * "crosshair") sbg penanda titiknya bisa diklik. */
  onPointClick?: (bucketKey: string) => void;
  /** Kontrol Tabel/Grafik dari LUAR (2026-08-25, instruksi eksplisit user: 1
   * tombol toggle bareng utk beberapa grafik sekaligus di Dashboard
   * Produktivitas, bukan 1 tombol terpisah per grafik) -- kalau diisi,
   * tombol "Lihat sbg Tabel/Grafik" bawaan komponen ini DISEMBUNYIKAN (parent
   * yg render tombol bareng-nya sendiri di luar, lihat
   * ProduktivitasDashboardPage.tsx). undefined (default) = mode lama, tiap
   * grafik py tombol & state sendiri-sendiri (dipakai QualityCheckReviewPage.tsx). */
  showTable?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [internalShowTable, setInternalShowTable] = useState(false);
  const isTableControlled = controlledShowTable !== undefined;
  const showTable = isTableControlled ? controlledShowTable : internalShowTable;
  const svgRef = useRef<SVGSVGElement>(null);

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const maxValue = useMemo(() => {
    let max = 0;
    for (const p of points) {
      for (const s of series) {
        const v = p.values[s.key] ?? 0;
        if (v > max) max = v;
      }
    }
    return niceCeil(max || 1);
  }, [points, series]);

  const xFor = (i: number) => (points.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (points.length - 1)) * plotW);
  const yFor = (v: number) => PAD.top + plotH - (v / maxValue) * plotH;

  const linePaths = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        d: points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.values[s.key] ?? 0).toFixed(1)}`).join(" "),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, series, maxValue]
  );

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxValue * f));

  const averages = useMemo(() => {
    if (!showAverage) return {};
    const out: Record<string, number> = {};
    for (const s of series) {
      const sum = points.reduce((acc, p) => acc + (p.values[s.key] ?? 0), 0);
      out[s.key] = points.length > 0 ? sum / points.length : 0;
    }
    return out;
  }, [points, series, showAverage]);

  const colWidth = points.length > 1 ? plotW / (points.length - 1) : plotW;

  // Label sumbu X: kalau bucket terlalu banyak, lewati beberapa spy tidak
  // tabrakan -- tampilkan maks ~12 label.
  const xLabelStep = Math.max(1, Math.ceil(points.length / 12));

  function pointIndexFromEvent(e: React.PointerEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>): number | null {
    if (!svgRef.current || points.length === 0) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const frac = points.length <= 1 ? 0 : (relX - PAD.left) / plotW;
    const idx = Math.round(frac * (points.length - 1));
    return Math.min(points.length - 1, Math.max(0, idx));
  }

  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    const idx = pointIndexFromEvent(e);
    if (idx !== null) setHoverIdx(idx);
  }

  function handleClick(e: React.MouseEvent<SVGRectElement>) {
    if (!onPointClick) return;
    const idx = pointIndexFromEvent(e);
    if (idx !== null) onPointClick(points[idx].bucketKey);
  }

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverX = hoverIdx !== null ? xFor(hoverIdx) : null;
  const tooltipOnRight = hoverX !== null && hoverX < CHART_W * 0.62;

  if (points.length === 0) {
    return <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>Belum ada data pada rentang ini.</div>;
  }

  return (
    <div>
      {!isTableControlled && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: "0.75rem", padding: "4px 10px" }}
            onClick={() => setInternalShowTable((s) => !s)}
          >
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
          <svg ref={svgRef} viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: "auto", display: "block", fontFamily: "inherit" }}>
            {/* Gridlines + label sumbu Y */}
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
            {/* Sumbu X label */}
            {points.map((p, i) =>
              i % xLabelStep === 0 ? (
                <text key={p.bucketKey} x={xFor(i)} y={CHART_H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="#898781">
                  {p.label}
                </text>
              ) : null
            )}
            {/* Area akhir pekan (Sabtu/Minggu) + garis pembatas di tepinya --
                cuma granularitas "day" yg py resolusi per-hari. */}
            {granularity === "day" &&
              points.map((p, i) => {
                if (![0, 6].includes(dayOfWeek(p.bucketKey))) return null;
                const x = xFor(i) - colWidth / 2;
                return <rect key={`wknd-${p.bucketKey}`} x={x} y={PAD.top} width={colWidth} height={plotH} fill="#0b0b0b" fillOpacity={0.035} />;
              })}
            {granularity === "day" &&
              points.map((p, i) => {
                const cur = [0, 6].includes(dayOfWeek(p.bucketKey));
                const prev = i > 0 ? [0, 6].includes(dayOfWeek(points[i - 1].bucketKey)) : false;
                if (cur === prev) return null;
                const x = xFor(i) - colWidth / 2;
                return <line key={`bound-${p.bucketKey}`} x1={x} x2={x} y1={PAD.top} y2={PAD.top + plotH} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,3" />;
              })}

            {/* Garis baseline */}
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="#c3c2b7" strokeWidth={1} />

            {/* Crosshair */}
            {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + plotH} stroke="#c3c2b7" strokeWidth={1} strokeDasharray="3,3" />}

            {/* Garis rata-rata per series (opsional, lihat prop showAverage) */}
            {showAverage &&
              series.map((s) => {
                const avg = averages[s.key] ?? 0;
                const y = yFor(avg);
                return (
                  <g key={`avg-${s.key}`}>
                    <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y} y2={y} stroke={s.color} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.55} />
                    <text x={CHART_W - PAD.right} y={y - 5} textAnchor="end" fontSize={11} fontWeight={700} fill={s.color}>
                      Rata-rata: {valueFormatter(avg)}
                    </text>
                  </g>
                );
              })}

            {/* Garis tiap tahap */}
            {linePaths.map((s) => (
              <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {/* Marker titik terakhir tiap tahap (nilai saat ini) */}
            {series.map((s) => {
              const lastPoint = points[points.length - 1];
              const cx = xFor(points.length - 1);
              const cy = yFor(lastPoint.values[s.key] ?? 0);
              return <circle key={s.key} cx={cx} cy={cy} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />;
            })}

            {/* Titik hover per tahap */}
            {hoverPoint &&
              series.map((s) => {
                const cx = xFor(hoverIdx!);
                const cy = yFor(hoverPoint.values[s.key] ?? 0);
                return <circle key={s.key} cx={cx} cy={cy} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />;
              })}

            {/* Overlay penangkap hover */}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIdx(null)}
              onClick={handleClick}
              style={{ cursor: onPointClick ? "pointer" : "crosshair" }}
            />
          </svg>

          <div style={{ position: "absolute", top: 0, left: PAD.left, fontSize: "0.7rem", color: "var(--text-muted)" }}>{yAxisLabel}</div>

          {hoverPoint && hoverX !== null && (
            <div
              style={{
                position: "absolute",
                top: 8,
                [tooltipOnRight ? "left" : "right"]: tooltipOnRight ? `${(hoverX / CHART_W) * 100 + 2}%` : `${100 - (hoverX / CHART_W) * 100 + 2}%`,
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
                  <span style={{ display: "inline-block", width: 10, height: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ color: "#64748b", flex: 1 }}>{s.label}</span>
                  <span style={{ fontWeight: 700, color: "#1e293b" }}>{valueFormatter(hoverPoint.values[s.key] ?? 0)}</span>
                </div>
              ))}
              {onPointClick && (
                <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", color: "#94a3b8", fontSize: "0.7rem" }}>
                  Klik untuk lihat IU Plant
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend -- selalu tampil (2026-08-21, >=2 series) */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, justifyContent: "center" }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 14, height: 2, background: s.color, borderRadius: 1 }} />
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{s.label}</span>
          </div>
        ))}
        {granularity === "day" && !showTable && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 14, height: 12, background: "rgba(11,11,11,0.09)", border: "1px dashed #94a3b8" }} />
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Akhir Pekan (Sabtu/Minggu)</span>
          </div>
        )}
      </div>
    </div>
  );
}
