import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import TrendLineChart, { TrendChartPoint, TrendSeries } from "./TrendLineChart";

type Period = "today" | "week" | "month" | "all" | "custom";

type Granularity = "day" | "week" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Harian" },
  { value: "week", label: "Mingguan" },
  { value: "month", label: "Bulanan" },
];

/** Sama persis dgn DAY_SCOPE_OPTIONS di QualityCheckReviewPage.tsx (2026-08-25,
 * instruksi eksplisit user: tampilan "☰ Cakupan Hari" disamakan). */
const DAY_SCOPE_OPTIONS: { value: "workdays" | "all"; label: string }[] = [
  { value: "workdays", label: "Hari Kerja Saja" },
  { value: "all", label: "Termasuk Sabtu/Minggu" },
];

/** Urutan & warna tetap per tahap (2026-08-21) -- 5 slot pertama palet
 * kategori terverifikasi (lihat skill dataviz), urutan TIDAK BOLEH diacak
 * krn itu bagian dari mekanisme aman-buta warnanya. */
const STAGE_SERIES: TrendSeries[] = [
  { key: "premix", label: "Premix", color: "#2a78d6" },
  { key: "milling", label: "Milling", color: "#eb6834" },
  { key: "aftermix", label: "Aftermix", color: "#1baf7a" },
  { key: "colourMatching", label: "Colour Matching", color: "#eda100" },
  { key: "packing", label: "Packing", color: "#e87ba4" },
];

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Label bucket dari `bucketKey` ("YYYY-MM-DD", selalu tanggal WIB) --
 * sengaja parse manual dari string, BUKAN `new Date(bucketStart)` lalu
 * `toLocaleDateString`, supaya tidak ketiban konversi timezone browser
 * (bucketKey sudah pasti kalender WIB dari backend). */
/** 0=Minggu, 6=Sabtu -- `Date.UTC` murni utk aritmetika kalender, bukan
 * konversi timezone lokal (bucketKey sudah tanggal WIB apa adanya). */
function isWeekendKey(bucketKey: string): boolean {
  const [y, m, d] = bucketKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

function formatBucketLabel(bucketKey: string, granularity: Granularity): string {
  const [y, m, d] = bucketKey.split("-").map(Number);
  if (granularity === "month") return `${MONTHS_ID[m - 1]} ${y}`;
  if (granularity === "week") {
    const start = new Date(Date.UTC(y, m - 1, d));
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const endDay = end.getUTCDate();
    const endMonth = end.getUTCMonth();
    return endMonth === m - 1 ? `${d}-${endDay} ${MONTHS_ID[m - 1]}` : `${d} ${MONTHS_ID[m - 1]} - ${endDay} ${MONTHS_ID[endMonth]}`;
  }
  return `${d} ${MONTHS_ID[m - 1]}`;
}

interface TrendBucket {
  bucketKey: string;
  premixCount: number;
  millingCount: number;
  aftermixCount: number;
  colourMatchingCount: number;
  packingCount: number;
  premixQty: number;
  millingQty: number;
  aftermixQty: number;
  colourMatchingQty: number;
  packingQty: number;
}

interface TrendData {
  granularity: Granularity;
  buckets: TrendBucket[];
}

interface ProduktivitasRow {
  iuPlant: string;
  /** KG/Ltr (jumlah Order Qty Finish) */
  premix: number;
  /** KG/Ltr (jumlah Qty Act Finish) */
  milling: number;
  /** KG/Ltr (jumlah Order Qty Finish) */
  aftermix: number;
  /** KG/Ltr (jumlah Order Qty Finish) */
  colourMatching: number;
  /** KG/Ltr (jumlah Qty/Pcs x Volume Finish) */
  packing: number;
  /** Premix+Milling+Aftermix+Colour Matching+Packing (KG/Ltr) -- semua kolom
   * satuannya seragam jadi Total menjumlah kelimanya. */
  totalQty: number;
}

const numberFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** "Produktivitas IU Plant/No Order" (2026-08-06, instruksi eksplisit user)
 * -- tabel KEDUA, terpisah dari ProduktivitasRow (KG/Ltr) di atas: jumlah No
 * Order (jumlah baris Finish) per tahap per IU Plant, bukan qty. */
interface ProduktivitasCountRow {
  iuPlant: string;
  premix: number;
  milling: number;
  aftermix: number;
  colourMatching: number;
  packing: number;
}

/** Breakdown per IU Plant utk 1 titik grafik tren yg diklik (2026-08-25,
 * instruksi eksplisit user: pop-up "lihat IU Plant" saat klik titik grafik
 * per-proses) -- GET /dashboard/produktivitas-trend-detail. */
interface TrendDetailRow {
  iuPlant: string;
  /** "Tanki Atas"/"Tanki Bawah"/"Tidak Diketahui" (2026-08-25, instruksi eksplisit user). */
  tipeTanki: string;
  count: number;
  qty: number;
}

interface TankOccupancyRow {
  plant: string;
  tipeTanki: string;
  /** TIDAK termasuk tanki Damaged (2026-08-06, instruksi eksplisit user) */
  total: number;
  terisi: number;
  kosong: number;
  /** Ditandai lewat checkbox "Damaged" di Master Data > Tanki -- dikeluarkan
   * dari total/kosong/terisi krn bukan kapasitas yg benar2 bisa dipakai. */
  damaged: number;
  percentTerisi: number;
}

interface ProduktivitasData {
  period: Period;
  productivity: ProduktivitasRow[];
  productivityOrderCount: ProduktivitasCountRow[];
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
 * user): 2 rangkuman -- (1) produktivitas per tahap, SEMUA kolom Qty
 * KG/Ltr (Premix/Aftermix/Colour Matching = Order Qty, Milling = Qty Act,
 * Packing = Qty/Pcs x Volume -- lihat komentar `buildProduktivitasData` di
 * dashboard.routes.ts utk detail per kolom, direvisi 2x 2026-08-06 instruksi
 * eksplisit user: pertama dari jumlah-baris ke Qty KG/Ltr, lalu Colour
 * Matching & Packing disamakan field sumbernya) dikelompokkan per IU Plant,
 * bisa difilter periode; (2) okupansi tanki (Kosong/Terisi/% Terisi)
 * dikelompokkan per Plant, sumber datanya SAMA dgn Dashboard > Tank
 * Monitoring (GET /dashboard/produktivitas gabungkan keduanya jadi 1
 * response supaya konsisten).
 */
type DashboardTab = "ringkasan" | "tren";

export default function ProduktivitasDashboardPage() {
  // Tab terpisah utk grafik tren (2026-08-21, instruksi eksplisit user) --
  // sebelumnya nempel jadi 1 scroll panjang bareng tabel Ringkasan, dipisah
  // supaya lebih jelas dibaca & tidak bikin halaman kepanjangan.
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("ringkasan");
  // Tombol periode cepat (Hari Ini/Minggu Ini/Bulan Ini/Semua) DIHAPUS
  // (2026-08-21, instruksi eksplisit user: sudah tidak diperlukan) --
  // filter tanggal kustom di bawah (`customFrom`/`customTo`) satu-satunya
  // cara filter rentang skrg. Tanpa rentang kustom diisi, defaultnya "all"
  // (tampilkan semua data) -- BUKAN "month" spt sblm tombol cepat dihapus,
  // supaya user tidak diam-diam kefilter ke bulan berjalan tanpa sadar.
  const period: Period = "all";
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const usingCustomRange = Boolean(customFrom || customTo);
  const [granularity, setGranularity] = useState<Granularity>("day");
  // Cakupan hari utk grafik tren (2026-08-21, instruksi eksplisit user: Sabtu/
  // Minggu produksinya tidak efektif, jangan ikut menarik rata-rata ke bawah,
  // TAPI tetap sediakan filter supaya bisa lihat 2 cara: khusus hari kerja
  // ATAU termasuk Sabtu/Minggu) -- default "workdays" (rekomendasi yg
  // disetujui user). Cuma berlaku kalau granularitas "day" (bucket Mingguan/
  // Bulanan sudah gabungan hari kerja+weekend, tidak bisa dipisah per-bucket).
  const [dayScope, setDayScope] = useState<"workdays" | "all">("workdays");
  // Grafik per proses (2026-08-21, instruksi eksplisit user: "grafik utk
  // tiap-tiap proses khusus", dgn garis rata-rata output produksinya).
  const [selectedStage, setSelectedStage] = useState<string>(STAGE_SERIES[0].key);
  const selectedStageSeries = STAGE_SERIES.find((s) => s.key === selectedStage) ?? STAGE_SERIES[0];
  // Dropdown "☰ Grafik per Proses" (2026-08-25, instruksi eksplisit user) --
  // sebelumnya 5 tombol tahap selalu tampil di baris sendiri di dalam tab
  // Tren; sekarang jadi 1 tombol + panel dropdown, pola SAMA PERSIS dgn
  // "☰ Kolom" di DataTable.tsx, dinaikkan ke baris filter atas (sejajar
  // Harian/Mingguan/Bulanan/Dari-Sampai Tanggal) supaya lebih ringkas.
  const [showStagePanel, setShowStagePanel] = useState(false);
  // Dropdown "☰ Cakupan Hari" (2026-08-25, instruksi eksplisit user) -- pola
  // & posisi SAMA dgn "☰ Grafik per Proses" di atas, gantikan 2 tombol
  // Hari Kerja Saja/Termasuk Sabtu-Minggu yg sebelumnya di baris sendiri.
  const [showDayScopePanel, setShowDayScopePanel] = useState(false);
  // 1 tombol "Lihat sbg Tabel/Grafik" BARENG utk ke-4 grafik tren sekaligus
  // (2026-08-25, instruksi eksplisit user: sebelumnya tiap grafik py tombol &
  // state sendiri-sendiri) -- dioper ke tiap <TrendLineChart> lewat prop
  // `showTable` terkontrol, lihat komentar di TrendLineChart.tsx.
  const [showTrendTable, setShowTrendTable] = useState(false);

  // Pop-up "lihat IU Plant" (2026-08-25, instruksi eksplisit user) -- klik
  // titik pada grafik per-proses (Jumlah Formula/Output Produksi) -> tampilkan
  // breakdown per IU Plant KHUSUS tahap & bucket (hari/minggu/bulan) yg
  // diklik itu saja, BUKAN seluruh rentang filter dashboard.
  const [detailBucket, setDetailBucket] = useState<{ bucketKey: string; label: string } | null>(null);
  const detailQuery = useQuery({
    queryKey: ["dashboard-produktivitas-trend-detail", selectedStage, detailBucket?.bucketKey, granularity],
    queryFn: () =>
      api
        .get<{ success: boolean; data: TrendDetailRow[] }>(
          `/dashboard/produktivitas-trend-detail?stage=${selectedStage}&bucketKey=${encodeURIComponent(detailBucket!.bucketKey)}&granularity=${granularity}`
        )
        .then((r) => r.data),
    enabled: detailBucket !== null,
  });

  function buildRangeParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (usingCustomRange) {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    } else {
      params.set("period", period);
    }
    return params;
  }

  const query = useQuery({
    queryKey: ["dashboard-produktivitas", period, customFrom, customTo],
    queryFn: () =>
      api
        .get<{ success: boolean; data: ProduktivitasData }>(`/dashboard/produktivitas?${buildRangeParams().toString()}`)
        .then((r) => r.data),
  });

  // Grafik tren (2026-08-21, instruksi eksplisit user): "rata-rata formula
  // yang dibuat per hari/minggu/bulan", menghormati rentang tanggal yg SAMA
  // dgn tabel di atas -- cuma ditambah toggle granularitas independen.
  const trendQuery = useQuery({
    queryKey: ["dashboard-produktivitas-trend", period, customFrom, customTo, granularity],
    queryFn: () => {
      const params = buildRangeParams();
      params.set("granularity", granularity);
      return api.get<{ success: boolean; data: TrendData }>(`/dashboard/produktivitas-trend?${params.toString()}`).then((r) => r.data);
    },
  });

  // "Hari Kerja Saja" cuma bisa diterapkan per-bucket kalau granularitasnya
  // "day" (Mingguan/Bulanan sudah gabungan hari kerja+weekend dlm 1 angka).
  const effectiveDayScope = granularity === "day" ? dayScope : "all";
  const trendBuckets = useMemo(() => {
    const raw = trendQuery.data?.buckets ?? [];
    return effectiveDayScope === "workdays" ? raw.filter((b) => !isWeekendKey(b.bucketKey)) : raw;
  }, [trendQuery.data, effectiveDayScope]);
  const trendPointsCount: TrendChartPoint[] = useMemo(
    () =>
      trendBuckets.map((b) => ({
        bucketKey: b.bucketKey,
        label: formatBucketLabel(b.bucketKey, granularity),
        values: {
          premix: b.premixCount,
          milling: b.millingCount,
          aftermix: b.aftermixCount,
          colourMatching: b.colourMatchingCount,
          packing: b.packingCount,
        },
      })),
    [trendBuckets, granularity]
  );
  const trendPointsQty: TrendChartPoint[] = useMemo(
    () =>
      trendBuckets.map((b) => ({
        bucketKey: b.bucketKey,
        label: formatBucketLabel(b.bucketKey, granularity),
        values: {
          premix: b.premixQty,
          milling: b.millingQty,
          aftermix: b.aftermixQty,
          colourMatching: b.colourMatchingQty,
          packing: b.packingQty,
        },
      })),
    [trendBuckets, granularity]
  );

  function handleTrendPointClick(bucketKey: string) {
    const point = trendPointsCount.find((p) => p.bucketKey === bucketKey);
    setDetailBucket({ bucketKey, label: point?.label ?? bucketKey });
  }

  const detailRows = detailQuery.data ?? [];
  const detailTotals = detailRows.reduce((acc, r) => ({ count: acc.count + r.count, qty: acc.qty + r.qty }), { count: 0, qty: 0 });

  const productivity = query.data?.productivity ?? [];
  const productivityOrderCount = query.data?.productivityOrderCount ?? [];
  const tankOccupancy = query.data?.tankOccupancy ?? [];

  const totalQtyDiproses = productivity.reduce((sum, r) => sum + r.totalQty, 0);
  const totalTanki = tankOccupancy.reduce((sum, r) => sum + r.total, 0);
  const totalTerisi = tankOccupancy.reduce((sum, r) => sum + r.terisi, 0);
  const overallPercentTerisi = totalTanki > 0 ? Math.round((totalTerisi / totalTanki) * 100) : 0;

  // Baris "Total" di bawah tiap tabel (2026-08-21, instruksi eksplisit user
  // -- BUKAN kolom tambahan di samping, footer row lewat prop `footer` DataTable).
  const totalKosong = tankOccupancy.reduce((sum, r) => sum + r.kosong, 0);
  const totalDamaged = tankOccupancy.reduce((sum, r) => sum + r.damaged, 0);

  const productivityTotals = productivity.reduce(
    (acc, r) => ({
      premix: acc.premix + r.premix,
      milling: acc.milling + r.milling,
      aftermix: acc.aftermix + r.aftermix,
      colourMatching: acc.colourMatching + r.colourMatching,
      packing: acc.packing + r.packing,
    }),
    { premix: 0, milling: 0, aftermix: 0, colourMatching: 0, packing: 0 }
  );

  const productivityOrderCountTotals = productivityOrderCount.reduce(
    (acc, r) => ({
      premix: acc.premix + r.premix,
      milling: acc.milling + r.milling,
      aftermix: acc.aftermix + r.aftermix,
      colourMatching: acc.colourMatching + r.colourMatching,
      packing: acc.packing + r.packing,
    }),
    { premix: 0, milling: 0, aftermix: 0, colourMatching: 0, packing: 0 }
  );

  return (
    <div className="panel">
      <div className="panel-header">Dashboard Produktivitas</div>
      <div className="panel-body">
        <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
          <button
            type="button"
            className={`btn ${dashboardTab === "ringkasan" ? "" : "btn-outline"}`}
            onClick={() => setDashboardTab("ringkasan")}
          >
            Ringkasan
          </button>
          <button type="button" className={`btn ${dashboardTab === "tren" ? "" : "btn-outline"}`} onClick={() => setDashboardTab("tren")}>
            Tren Produktivitas
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`btn ${granularity === opt.value ? "" : "btn-outline"}`}
                onClick={() => setGranularity(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {dashboardTab === "tren" && (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className={`btn ${showStagePanel ? "" : "btn-outline"}`}
                onClick={() => setShowStagePanel((s) => !s)}
              >
                ☰ Grafik per Proses
              </button>
              {showStagePanel && (
                <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 220, padding: 10 }}>
                  {STAGE_SERIES.map((s) => (
                    <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem" }}>
                      <input
                        type="radio"
                        name="produktivitas-trend-stage"
                        checked={selectedStage === s.key}
                        onChange={() => setSelectedStage(s.key)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {dashboardTab === "tren" && (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className={`btn ${showDayScopePanel ? "" : "btn-outline"}`}
                disabled={granularity !== "day"}
                onClick={() => setShowDayScopePanel((s) => !s)}
              >
                ☰ Cakupan Hari
              </button>
              {showDayScopePanel && (
                <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 220, padding: 10 }}>
                  {DAY_SCOPE_OPTIONS.map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem" }}>
                      <input
                        type="radio"
                        name="produktivitas-trend-day-scope"
                        checked={dayScope === opt.value}
                        onChange={() => setDayScope(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {dashboardTab === "tren" && (
            <button type="button" className="btn btn-outline" onClick={() => setShowTrendTable((s) => !s)}>
              {showTrendTable ? "Lihat sbg Grafik" : "Lihat sbg Tabel"}
            </button>
          )}
          <div className="field" style={{ maxWidth: 180 }}>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 180 }}>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
          {usingCustomRange && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Rentang tanggal aktif.</span>
          )}
          {usingCustomRange && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setCustomFrom("");
                setCustomTo("");
              }}
            >
              Reset Tanggal
            </button>
          )}
        </div>

        {dashboardTab === "ringkasan" && (
        <>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <KpiCard label="Total Qty Diproses (KG/Ltr)" value={numberFmt.format(totalQtyDiproses)} color="var(--navy-light)" />
          <KpiCard label="Total Tanki" value={totalTanki} color="var(--navy-light)" />
          <KpiCard label="Tanki Terisi" value={totalTerisi} color="var(--danger)" />
          <KpiCard label="Tanki Kosong" value={totalTanki - totalTerisi} color="var(--success)" />
          <KpiCard label="% Terisi Keseluruhan" value={`${overallPercentTerisi}%`} color="#d97706" />
        </div>

        <h3 style={{ marginBottom: 4 }}>Okupansi Tanki per Plant</h3>
        <p style={{ marginTop: 0, marginBottom: 8, color: "var(--text-muted)", fontSize: "0.78rem" }}>
          Menampilkan kondisi tanki <strong>saat ini</strong> (real-time, sama dengan Dashboard &gt; Tank Monitoring) --
          tombol periode/rentang tanggal di atas TIDAK berpengaruh ke tabel ini. Tanki yang ditandai{" "}
          <strong>Damaged</strong> (Master Data &gt; Tanki) dikeluarkan dari Total/Kosong/Terisi/% Terisi -- dihitung
          terpisah di kolom Damaged.
        </p>
        <DataTable
          rowKey={(r: TankOccupancyRow) => `${r.plant}-${r.tipeTanki}`}
          exportFileName="dashboard-produktivitas-tanki"
          storageKey="dashboard-produktivitas-tanki-v3"
          rows={tankOccupancy}
          emptyMessage="Belum ada data tanki."
          columns={[
            { key: "plant", label: "Plant", render: (r) => r.plant },
            { key: "tipeTanki", label: "Tipe Tanki", render: (r) => r.tipeTanki },
            { key: "total", label: "Total Tanki", render: (r) => r.total },
            { key: "terisi", label: "Terisi", render: (r) => r.terisi },
            { key: "kosong", label: "Kosong", render: (r) => r.kosong },
            {
              key: "damaged",
              label: "Damaged",
              render: (r) => <span style={{ color: r.damaged > 0 ? "var(--danger)" : undefined, fontWeight: r.damaged > 0 ? 700 : undefined }}>{r.damaged}</span>,
              csvValue: (r) => r.damaged,
            },
            {
              key: "percentTerisi",
              label: "% Terisi",
              defaultWidth: 220,
              render: (r) => <OccupancyBar percent={r.percentTerisi} />,
              csvValue: (r) => `${r.percentTerisi}%`,
            },
          ]}
          footer={{
            plant: "Total",
            total: totalTanki,
            terisi: totalTerisi,
            kosong: totalKosong,
            damaged: totalDamaged,
            percentTerisi: `${overallPercentTerisi}%`,
          }}
        />

        <h3 style={{ marginTop: 28, marginBottom: 4 }}>Produktivitas IU Plant/LTR</h3>
        <p style={{ marginTop: 0, marginBottom: 8, color: "var(--text-muted)", fontSize: "0.78rem" }}>
          Semua kolom = <strong>jumlah Qty (KG/Ltr)</strong> yang sudah selesai (Finish) di tahap itu (Premix/
          Aftermix/Colour Matching dari Order Qty, Milling dari Qty Act, Packing dari Qty/Pcs x Volume).
        </p>
        <DataTable
          rowKey={(r: ProduktivitasRow) => r.iuPlant}
          exportFileName="dashboard-produktivitas-tim"
          storageKey="dashboard-produktivitas-tim-v3"
          rows={productivity}
          emptyMessage="Belum ada proses yang Finish pada periode ini."
          columns={[
            { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
            { key: "premix", label: "Premix (KG/Ltr)", render: (r) => numberFmt.format(r.premix), csvValue: (r) => r.premix },
            { key: "milling", label: "Milling (KG/Ltr)", render: (r) => numberFmt.format(r.milling), csvValue: (r) => r.milling },
            { key: "aftermix", label: "Aftermix (KG/Ltr)", render: (r) => numberFmt.format(r.aftermix), csvValue: (r) => r.aftermix },
            {
              key: "colourMatching",
              label: "Colour Matching (KG/Ltr)",
              render: (r) => numberFmt.format(r.colourMatching),
              csvValue: (r) => r.colourMatching,
            },
            { key: "packing", label: "Packing (KG/Ltr)", render: (r) => numberFmt.format(r.packing), csvValue: (r) => r.packing },
          ]}
          footer={{
            iuPlant: "Total",
            premix: numberFmt.format(productivityTotals.premix),
            milling: numberFmt.format(productivityTotals.milling),
            aftermix: numberFmt.format(productivityTotals.aftermix),
            colourMatching: numberFmt.format(productivityTotals.colourMatching),
            packing: numberFmt.format(productivityTotals.packing),
          }}
        />

        <h3 style={{ marginTop: 28, marginBottom: 4 }}>Produktivitas IU Plant/No Order</h3>
        <p style={{ marginTop: 0, marginBottom: 8, color: "var(--text-muted)", fontSize: "0.78rem" }}>
          Semua kolom = <strong>jumlah No Order</strong> yang sudah selesai (Finish) di tahap itu, per IU Plant.
        </p>
        <DataTable
          rowKey={(r: ProduktivitasCountRow) => r.iuPlant}
          exportFileName="dashboard-produktivitas-tim-order-count"
          storageKey="dashboard-produktivitas-tim-order-count"
          rows={productivityOrderCount}
          emptyMessage="Belum ada proses yang Finish pada periode ini."
          columns={[
            { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
            { key: "premix", label: "Premix", render: (r) => r.premix },
            { key: "milling", label: "Milling", render: (r) => r.milling },
            { key: "aftermix", label: "Aftermix", render: (r) => r.aftermix },
            { key: "colourMatching", label: "Colour Matching", render: (r) => r.colourMatching },
            { key: "packing", label: "Packing", render: (r) => r.packing },
          ]}
          footer={{
            iuPlant: "Total",
            premix: productivityOrderCountTotals.premix,
            milling: productivityOrderCountTotals.milling,
            aftermix: productivityOrderCountTotals.aftermix,
            colourMatching: productivityOrderCountTotals.colourMatching,
            packing: productivityOrderCountTotals.packing,
          }}
        />
        </>
        )}

        {dashboardTab === "tren" && (
        <>
        {granularity !== "day" && (
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.72rem" }}>
            Filter Cakupan Hari cuma berlaku di granularitas Harian -- bucket Mingguan/Bulanan sudah menggabungkan
            hari kerja & Sabtu/Minggu jadi 1 angka.
          </p>
        )}

        <h3 style={{ marginTop: 8, marginBottom: 12 }}>Grafik per Proses</h3>

        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {selectedStageSeries.label} -- Jumlah Formula (Order) Selesai
          </div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Garis putus-putus = rata-rata jumlah Order per {GRANULARITY_OPTIONS.find((o) => o.value === granularity)?.label.toLowerCase()}
            {" "}pada rentang ini.
          </p>
          <TrendLineChart
            points={trendPointsCount}
            series={[selectedStageSeries]}
            yAxisLabel="Jumlah Order"
            granularity={granularity}
            showAverage
            onPointClick={handleTrendPointClick}
            showTable={showTrendTable}
          />
        </div>

        <div className="panel" style={{ padding: 16, marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {selectedStageSeries.label} -- Rata-rata Output Produksi (KG/Ltr)
          </div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Garis putus-putus = rata-rata Qty (KG/Ltr) output produksi per {GRANULARITY_OPTIONS.find((o) => o.value === granularity)?.label.toLowerCase()}
            {" "}pada rentang ini.
          </p>
          <TrendLineChart
            points={trendPointsQty}
            series={[selectedStageSeries]}
            yAxisLabel="KG/Ltr"
            valueFormatter={(n) => numberFmt.format(n)}
            granularity={granularity}
            showAverage
            onPointClick={handleTrendPointClick}
            showTable={showTrendTable}
          />
        </div>

        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Jumlah Formula (Order) Selesai</div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Jumlah Order/Batch yang Finish per tahap, per {GRANULARITY_OPTIONS.find((o) => o.value === granularity)?.label.toLowerCase()}.
          </p>
          <TrendLineChart points={trendPointsCount} series={STAGE_SERIES} yAxisLabel="Jumlah Order" granularity={granularity} showTable={showTrendTable} />
        </div>

        <div className="panel" style={{ padding: 16, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Total Qty (KG/Ltr) Diproses</div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Total Qty (KG/Ltr) Finish per tahap, per {GRANULARITY_OPTIONS.find((o) => o.value === granularity)?.label.toLowerCase()}.
          </p>
          <TrendLineChart
            points={trendPointsQty}
            series={STAGE_SERIES}
            yAxisLabel="KG/Ltr"
            valueFormatter={(n) => numberFmt.format(n)}
            granularity={granularity}
            showTable={showTrendTable}
          />
        </div>
        </>
        )}

        {detailBucket && (
          <Modal
            title={`${selectedStageSeries.label} -- ${detailBucket.label}`}
            onClose={() => setDetailBucket(null)}
            width={520}
          >
            {detailQuery.isLoading ? (
              <p style={{ color: "var(--text-muted)" }}>Memuat...</p>
            ) : detailRows.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>Belum ada proses {selectedStageSeries.label} yang Finish pada periode ini.</p>
            ) : (
              <table className="data-table" style={{ fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th>IU Plant</th>
                    <th>Tipe Tanki</th>
                    <th>Jumlah Order</th>
                    <th>Qty (KG/Ltr)</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r) => (
                    <tr key={`${r.iuPlant}-${r.tipeTanki}`}>
                      <td>{r.iuPlant}</td>
                      <td>{r.tipeTanki}</td>
                      <td>{r.count}</td>
                      <td>{numberFmt.format(r.qty)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={2}>Total</td>
                    <td>{detailTotals.count}</td>
                    <td>{numberFmt.format(detailTotals.qty)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}
