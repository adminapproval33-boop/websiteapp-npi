import { useMemo, useRef, useState } from "react";
import { SpecVerdict, SPEC_VERDICT_LABEL } from "../../lib/specEval";

export interface QcTrendPoint {
  key: string;
  label: string;
  order: string;
  batch: string | null;
  value: number;
  resultRaw: string;
  spec: string | null;
  verdict: SpecVerdict;
}

const CHART_W = 900;
const CHART_H = 300;
// bottom lebih besar drpd TrendLineChart.tsx (40) -- label sumbu-X di sini
// Batch (bisa panjang, mis. "2608062136"), dirotasi miring supaya muat &
// tidak saling tabrakan, butuh ruang vertikal lebih.
const PAD = { top: 16, right: 16, bottom: 56, left: 56 };

/** Warna status verdict (2026-08-23) -- SAMA hex dgn yg sudah dipakai di
 * tempat lain di app ini (mis. STATUS_COLOR di QualityCheckReviewPage.tsx,
 * var(--danger)/var(--success) di app.css), bukan palet baru, supaya
 * konsisten lintas halaman. Titik (bukan garis) yg diwarnai per verdict --
 * garis penghubungnya sendiri netral (slate) krn yg mau ditonjolkan adalah
 * "titik ini OK/NG", bukan identitas 1 series. */
function verdictColor(v: SpecVerdict): string {
  if (v === "ng") return "#ef4444";
  if (v === "unknown") return "#94a3b8";
  return "#22c55e";
}

/** Angka "bulat cantik" >= `n` (0/1/2/5 x 10^k), dan turunannya utk batas
 * bawah (bisa negatif) -- sama pola dgn niceCeil di TrendLineChart.tsx
 * (ProduktivitasDashboard), diduplikasi di sini krn scoped ke 1 series
 * dgn kemungkinan nilai negatif (TrendLineChart lama selalu mulai dari 0). */
function niceBounds(min: number, max: number): { lo: number; hi: number } {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const exp = Math.floor(Math.log10(span || 1));
  const step = Math.pow(10, exp) / 2 || 0.1;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { lo, hi };
}

/**
 * Grafik tren 1 Item Check utk 1 Material Number (2026-08-23, instruksi
 * eksplisit user: "grafik history hasil pengecekan Quality Check / Material
 * Number") -- sumbu-X kronologis (Tanggal Masuk QC), sumbu-Y nilai Result
 * (numerik), titik diwarnai per verdict (evaluateSpec: hijau=OK, merah=NG,
 * abu=tidak diketahui) supaya OK/NG kelihatan sekali lihat tanpa perlu
 * menggambar band Spec (parsing semua bentuk Spec -- rentang/pembanding/
 * toleransi/HARDNESS -- jadi geometri band itu sendiri kompleks & rawan
 * salah gambar; verdict per-titik sudah cukup komunikatif, Spec mentahnya
 * tetap ditampilkan di tooltip & tabel). Struktur SVG (gridline/crosshair/
 * tooltip/toggle tabel) diadaptasi dari TrendLineChart.tsx (ProduktivitasDashboard)
 * supaya konsisten dgn chart lain di app ini.
 */
export default function QcTrendChart({
  points,
  valueLabel,
  showTable,
  onToggleTable,
}: {
  points: QcTrendPoint[];
  valueLabel: string;
  showTable: boolean;
  onToggleTable?: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const { lo, hi } = useMemo(() => {
    if (points.length === 0) return { lo: 0, hi: 1 };
    const values = points.map((p) => p.value);
    return niceBounds(Math.min(...values), Math.max(...values));
  }, [points]);

  const xFor = (i: number) => (points.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (points.length - 1)) * plotW);
  const yFor = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const linePath = useMemo(
    () => points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.value).toFixed(1)}`).join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, lo, hi]
  );

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);

  const xLabelStep = Math.max(1, Math.ceil(points.length / 10));

  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const frac = points.length <= 1 ? 0 : (relX - PAD.left) / plotW;
    const idx = Math.round(frac * (points.length - 1));
    setHoverIdx(Math.min(points.length - 1, Math.max(0, idx)));
  }

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverX = hoverIdx !== null ? xFor(hoverIdx) : null;
  const tooltipOnRight = hoverX !== null && hoverX < CHART_W * 0.62;

  if (points.length === 0) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Belum ada data Result berupa angka utk Item Check ini.
      </div>
    );
  }

  return (
    <div>
      {onToggleTable && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button type="button" className="btn btn-outline" style={{ fontSize: "0.75rem", padding: "4px 10px" }} onClick={onToggleTable}>
            {showTable ? "Lihat sbg Grafik" : "Lihat sbg Tabel"}
          </button>
        </div>
      )}

      {showTable ? (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Order</th>
                <th>Batch</th>
                <th>Spec</th>
                <th>Result</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td>{p.order}</td>
                  <td>{p.batch ?? "-"}</td>
                  <td>{p.spec ?? "-"}</td>
                  <td>{p.resultRaw}</td>
                  <td style={{ color: verdictColor(p.verdict), fontWeight: 700 }}>{SPEC_VERDICT_LABEL[p.verdict]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg ref={svgRef} viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: "auto", display: "block", fontFamily: "inherit" }}>
            {yTicks.map((t) => {
              const y = yFor(t);
              return (
                <g key={t}>
                  <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y} y2={y} stroke="#e1e0d9" strokeWidth={1} />
                  <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#898781">
                    {t.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                  </text>
                </g>
              );
            })}
            {/* Sumbu-X = Batch (2026-08-23, instruksi eksplisit user: langsung
                kelihatan batch mana yg OK/NG tanpa perlu hover) -- BUKAN
                tanggal lagi, tanggalnya tetap ada di tooltip hover (lihat
                header tooltip di bawah, masih pakai `p.label`). Batch bisa
                cukup panjang (mis. "2608062136") jadi dirotasi miring supaya
                antar-label tidak saling tabrakan. */}
            {points.map((p, i) =>
              i % xLabelStep === 0 ? (
                <text
                  key={p.key}
                  x={xFor(i)}
                  y={CHART_H - PAD.bottom + 18}
                  textAnchor="end"
                  fontSize={11}
                  fill="#898781"
                  transform={`rotate(-40 ${xFor(i)} ${CHART_H - PAD.bottom + 18})`}
                >
                  {p.batch ?? "-"}
                </text>
              ) : null
            )}

            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="#c3c2b7" strokeWidth={1} />

            {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + plotH} stroke="#c3c2b7" strokeWidth={1} strokeDasharray="3,3" />}

            <path d={linePath} fill="none" stroke="#64748b" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {points.map((p, i) => (
              <circle key={p.key} cx={xFor(i)} cy={yFor(p.value)} r={hoverIdx === i ? 6 : 4} fill={verdictColor(p.verdict)} stroke="#fff" strokeWidth={2} />
            ))}

            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIdx(null)}
              style={{ cursor: "crosshair" }}
            />
          </svg>

          <div style={{ position: "absolute", top: 0, left: PAD.left, fontSize: "0.7rem", color: "var(--text-muted)" }}>{valueLabel}</div>

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
                minWidth: 180,
                pointerEvents: "none",
                zIndex: 5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4, color: "#1e293b" }}>{hoverPoint.label}</div>
              <div style={{ color: "#64748b" }}>Order: <strong style={{ color: "#1e293b" }}>{hoverPoint.order}</strong></div>
              {hoverPoint.batch && <div style={{ color: "#64748b" }}>Batch: <strong style={{ color: "#1e293b" }}>{hoverPoint.batch}</strong></div>}
              <div style={{ color: "#64748b" }}>Spec: <strong style={{ color: "#1e293b" }}>{hoverPoint.spec ?? "-"}</strong></div>
              <div style={{ color: "#64748b" }}>
                Result: <strong style={{ color: "#1e293b" }}>{hoverPoint.resultRaw}</strong>
              </div>
              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: verdictColor(hoverPoint.verdict) }} />
                <span style={{ fontWeight: 700, color: verdictColor(hoverPoint.verdict) }}>{SPEC_VERDICT_LABEL[hoverPoint.verdict]}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend status -- SELALU tampil (identitas verdict tidak boleh cuma
          lewat warna titik, lihat tooltip di atas yg juga menuliskan label
          verdict-nya scr eksplisit). */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: verdictColor("ok") }} />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>OK</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: verdictColor("ng") }} />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>NG</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: verdictColor("unknown") }} />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Tidak diketahui</span>
        </div>
      </div>
    </div>
  );
}
