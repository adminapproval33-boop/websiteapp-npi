import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";

type Period = "today" | "week" | "month" | "all";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Hari Ini" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "all", label: "Semua" },
];

interface ProduktivitasRow {
  iuPlant: string;
  /** KG/Ltr (jumlah Order Qty Finish) */
  premix: number;
  /** KG/Ltr (jumlah Qty Act Finish) */
  milling: number;
  /** KG/Ltr (jumlah Order Qty Finish) */
  aftermix: number;
  /** Jumlah No Order Finish -- SATU-SATUNYA kolom yg bukan KG/Ltr */
  colourMatching: number;
  /** KG/Ltr (jumlah Qty/Man Finish) */
  packing: number;
  /** Premix+Milling+Aftermix+Packing SAJA (KG/Ltr) -- Colour Matching sengaja
   * tidak diikutkan krn satuannya beda (jumlah Order, bukan KG/Ltr) */
  totalQty: number;
}

const numberFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

interface TankOccupancyRow {
  plant: string;
  tipeTanki: string;
  total: number;
  terisi: number;
  kosong: number;
  percentTerisi: number;
}

interface ProduktivitasData {
  period: Period;
  productivity: ProduktivitasRow[];
  tankOccupancy: TankOccupancyRow[];
}

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

/** Bar okupansi tanki 1 baris -- pola visual sama dgn Proses Bar di
 * Production Order Monitoring (persentase + bar warna), disederhanakan
 * jadi 1 warna krn cuma 1 metrik (% Terisi), bukan gradasi banyak tahap. */
function OccupancyBar({ percent }: { percent: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
      <div style={{ position: "relative", width: 90, height: 14, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", flexShrink: 0 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${percent}%`,
            background: percent >= 80 ? "var(--danger)" : percent >= 40 ? "#d97706" : "var(--success)",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: "0.85rem", fontWeight: 700, minWidth: 36 }}>{percent}%</span>
    </div>
  );
}

/**
 * Dashboard > Dashboard Produktivitas (2026-08-02, instruksi eksplisit
 * user): 2 rangkuman -- (1) produktivitas per tahap (Premix/Milling/
 * Aftermix/Packing dlm Qty KG/Ltr, Colour Matching dlm jumlah No Order --
 * lihat komentar `buildProduktivitasData` di dashboard.routes.ts utk field
 * sumber tiap kolom, direvisi 2026-08-06 instruksi eksplisit user dari
 * jumlah-baris ke Qty KG/Ltr) dikelompokkan per IU Plant, bisa difilter
 * periode; (2) okupansi tanki (Kosong/Terisi/% Terisi) dikelompokkan per
 * Plant, sumber datanya SAMA dgn Dashboard > Tank Monitoring (GET
 * /dashboard/produktivitas gabungkan keduanya jadi 1 response supaya
 * konsisten).
 */
export default function ProduktivitasDashboardPage() {
  const [period, setPeriod] = useState<Period>("month");

  const query = useQuery({
    queryKey: ["dashboard-produktivitas", period],
    queryFn: () =>
      api.get<{ success: boolean; data: ProduktivitasData }>(`/dashboard/produktivitas?period=${period}`).then((r) => r.data),
  });

  const productivity = query.data?.productivity ?? [];
  const tankOccupancy = query.data?.tankOccupancy ?? [];

  const totalQtyDiproses = productivity.reduce((sum, r) => sum + r.totalQty, 0);
  const totalColourMatching = productivity.reduce((sum, r) => sum + r.colourMatching, 0);
  const totalTanki = tankOccupancy.reduce((sum, r) => sum + r.total, 0);
  const totalTerisi = tankOccupancy.reduce((sum, r) => sum + r.terisi, 0);
  const overallPercentTerisi = totalTanki > 0 ? Math.round((totalTerisi / totalTanki) * 100) : 0;

  return (
    <div className="panel">
      <div className="panel-header">Dashboard Produktivitas</div>
      <div className="panel-body">
        <p style={{ marginTop: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Rangkuman produktivitas tim per IU Plant (Qty KG/Ltr yang sudah Finish di tiap tahap, kecuali Colour
          Matching yang dihitung jumlah No Order) dan okupansi tanki per Plant (sumber sama dengan Dashboard &gt;
          Tank Monitoring).
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn ${period === opt.value ? "" : "btn-outline"}`}
              onClick={() => setPeriod(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <KpiCard label="Total Qty Diproses (KG/Ltr)" value={numberFmt.format(totalQtyDiproses)} color="var(--navy-light)" />
          <KpiCard label="Total Order Colour Matching" value={totalColourMatching} color="var(--navy-light)" />
          <KpiCard label="Total Tanki" value={totalTanki} color="var(--navy-light)" />
          <KpiCard label="Tanki Terisi" value={totalTerisi} color="var(--danger)" />
          <KpiCard label="Tanki Kosong" value={totalTanki - totalTerisi} color="var(--success)" />
          <KpiCard label="% Terisi Keseluruhan" value={`${overallPercentTerisi}%`} color="#d97706" />
        </div>

        <h3 style={{ marginBottom: 4 }}>Produktivitas Tim per IU Plant</h3>
        <p style={{ marginTop: 0, marginBottom: 8, color: "var(--text-muted)", fontSize: "0.78rem" }}>
          Premix/Milling/Aftermix/Packing = <strong>jumlah Qty (KG/Ltr)</strong> yang sudah selesai (Finish) di tahap
          itu. Colour Matching = <strong>jumlah No Order</strong> yang dikerjakan (modul ini tidak punya Qty
          KG/Ltr). Kolom Total hanya menjumlah Premix+Milling+Aftermix+Packing (Colour Matching tidak diikutkan
          karena satuannya beda).
        </p>
        <DataTable
          rowKey={(r: ProduktivitasRow) => r.iuPlant}
          exportFileName="dashboard-produktivitas-tim"
          storageKey="dashboard-produktivitas-tim-v2"
          rows={productivity}
          emptyMessage="Belum ada proses yang Finish pada periode ini."
          columns={[
            { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
            { key: "premix", label: "Premix (KG/Ltr)", render: (r) => numberFmt.format(r.premix), csvValue: (r) => r.premix },
            { key: "milling", label: "Milling (KG/Ltr)", render: (r) => numberFmt.format(r.milling), csvValue: (r) => r.milling },
            { key: "aftermix", label: "Aftermix (KG/Ltr)", render: (r) => numberFmt.format(r.aftermix), csvValue: (r) => r.aftermix },
            { key: "colourMatching", label: "Colour Matching (Jumlah No Order)", render: (r) => r.colourMatching },
            { key: "packing", label: "Packing (KG/Ltr)", render: (r) => numberFmt.format(r.packing), csvValue: (r) => r.packing },
            {
              key: "totalQty",
              label: "Total (KG/Ltr)",
              render: (r) => <strong>{numberFmt.format(r.totalQty)}</strong>,
              csvValue: (r) => r.totalQty,
            },
          ]}
        />

        <h3 style={{ marginTop: 28, marginBottom: 8 }}>Okupansi Tanki per Plant</h3>
        <DataTable
          rowKey={(r: TankOccupancyRow) => `${r.plant}-${r.tipeTanki}`}
          exportFileName="dashboard-produktivitas-tanki"
          storageKey="dashboard-produktivitas-tanki-v2"
          rows={tankOccupancy}
          emptyMessage="Belum ada data tanki."
          columns={[
            { key: "plant", label: "Plant", render: (r) => r.plant },
            { key: "tipeTanki", label: "Tipe Tanki", render: (r) => r.tipeTanki },
            { key: "total", label: "Total Tanki", render: (r) => r.total },
            { key: "terisi", label: "Terisi", render: (r) => r.terisi },
            { key: "kosong", label: "Kosong", render: (r) => r.kosong },
            {
              key: "percentTerisi",
              label: "% Terisi",
              defaultWidth: 220,
              render: (r) => <OccupancyBar percent={r.percentTerisi} />,
              csvValue: (r) => `${r.percentTerisi}%`,
            },
          ]}
        />
      </div>
    </div>
  );
}
