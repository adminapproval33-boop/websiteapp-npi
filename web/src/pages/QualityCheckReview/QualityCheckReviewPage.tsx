import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { evaluateSpec } from "../../lib/specEval";
import QcTrendChart, { QcTrendPoint } from "./QcTrendChart";
import TrendLineChart, { TrendChartPoint, TrendSeries } from "../ProduktivitasDashboard/TrendLineChart";

type OrderQcStatus = "OK" | "On Check" | "Improve" | "Approval";

interface QualityReviewRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  plant: string | null;
  customer: string | null;
  status: OrderQcStatus;
  adminQcStage: string | null;
  qcTimestamp: string | null;
  qcPassed: string | null;
}

interface QualityReviewData {
  rows: QualityReviewRow[];
}

interface MaterialOption {
  materialNumber: string;
  materialDescription: string | null;
}

interface MaterialTrendRawRow {
  order: string;
  batch: string | null;
  timestamp: string;
  itemCheck: string;
  spec: string | null;
  result: string | null;
}

interface MaterialTrendData {
  itemChecks: string[];
  rows: MaterialTrendRawRow[];
}

type Granularity = "day" | "week" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Harian" },
  { value: "week", label: "Mingguan" },
  { value: "month", label: "Bulanan" },
];

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

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

interface QcOkTrendBucket {
  bucketKey: string;
  orderCount: number;
  qty: number;
}

interface QcOkTrendData {
  granularity: Granularity;
  buckets: QcOkTrendBucket[];
}

const OK_TREND_SERIES: TrendSeries = { key: "ok", label: "OK (QC Passed)", color: "#22c55e" };

const STATUS_COLOR: Record<OrderQcStatus, string> = {
  OK: "#22c55e",
  "On Check": "#94a3b8",
  Improve: "#f59e0b",
  Approval: "#0ea5e9",
};

const STATUS_OPTIONS: { value: OrderQcStatus; label: string }[] = [
  { value: "OK", label: "OK (QC Passed)" },
  { value: "On Check", label: "On Check" },
  { value: "Improve", label: "Improve" },
  { value: "Approval", label: "Approval" },
];

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

/**
 * Dashboard > Quality Check Review (2026-08-23, REVISI TOTAL sesuai instruksi
 * eksplisit user -- versi lama merekap per-baris Spec Parameter/verdict
 * OK-NG, DIGANTI TOTAL jadi rekap per NO ORDER dgn 4 status kerja QC. Logika
 * lengkap penentuan status ada di backend (dashboard.routes.ts) -- halaman
 * ini murni menampilkan hasilnya:
 *   - "OK"       : Order sudah py "QC Passed" (kolom qcPassed di AdminQc).
 *   - "Approval" : belum QC Passed, Admin QC Stage TERBARU = "Approval".
 *   - "Improve"  : belum QC Passed, Admin QC Stage TERBARU = "Improve".
 *   - "On Check" : belum QC Passed, Admin QC Stage TERBARU BUKAN
 *                  Approval/Improve, TAPI sudah py minimal 1 baris Input
 *                  Check Results (sudah masuk antrian QC).
 *
 * Filter "Status" (2026-08-23, follow-up instruksi eksplisit user, DIREVISI
 * lagi sesuai instruksi eksplisit user berikutnya: tombolnya dibuat SAMA spt
 * tombol "Kolom" bawaan DataTable & sejajar dgn Kolom/Filter/Reset Kolom
 * dalam 1 baris -- pola sama persis dgn filter "TA/TB"/"Status Tanki" di
 * TankDashboardPage.tsx, dirender lewat prop `toolbarExtraLeft` DataTable)
 * -- multi-select, tidak ada yg dicentang = tampilkan semua. 5 kartu KPI
 * (Total + 4 status) SENGAJA dihitung dari `filteredRows` (baris SETELAH
 * difilter Status), BUKAN dari total keseluruhan tanpa filter -- supaya
 * begitu user filter, kartu KPI ikut "berubah sesuai apa yang dipilih"
 * (kartu status yg tidak dicentang otomatis jadi 0) -- ini behavior yg
 * diminta eksplisit, bukan bug.
 */
export default function QualityCheckReviewPage() {
  const [tab, setTab] = useState<"ringkasan" | "trend" | "ok-trend">("ringkasan");
  const [statusFilter, setStatusFilter] = useState<Set<OrderQcStatus>>(new Set());
  const [showStatusPanel, setShowStatusPanel] = useState(false);

  const query = useQuery({
    queryKey: ["quality-check-review"],
    queryFn: () => api.get<{ success: boolean; data: QualityReviewData }>("/dashboard/quality-check-review").then((r) => r.data),
  });

  // Tab "Quality Check / Material Number" (2026-08-23, instruksi eksplisit
  // user: grafik history hasil pengecekan per Material Number). Pilih 1
  // Material Number -> muncul dropdown Item Check (Fineness/Visco/dst,
  // diambil dari histori material itu) -> pilih 1 -> digambar sbg grafik tren
  // (QcTrendChart). Data Material Number utk datalist saran diambil terpisah
  // (endpoint ringan, cuma daftar nama) dari histori lengkap per-material yg
  // BARU di-fetch begitu 1 Material Number valid diketik (endpoint lebih
  // berat, py semua baris Spec Parameter).
  const [materialNumberInput, setMaterialNumberInput] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState("");
  const [selectedItemCheck, setSelectedItemCheck] = useState("");
  // 2 tampilan (2026-08-23, instruksi eksplisit user): "single" = 1 grafik utk
  // Item Check terpilih (dropdown, spt sebelumnya -- lebih ringkas/fokus).
  // "all" = SEMUA Item Check material ini sekaligus, ditumpuk vertikal
  // (small-multiples) -- opsi ini sempat ditarik user pas masih dibahas
  // sbg pengganti TOTAL utk dropdown ("terlalu panjang"), tapi sekarang
  // diminta lagi sbg tampilan KEDUA yg terpisah/opsional, bukan pengganti.
  const [viewMode, setViewMode] = useState<"single" | "all">("single");
  // Toggle Tabel/Grafik SATU tombol utk semua grafik yg lagi ditampilkan
  // (2026-08-23, instruksi eksplisit user: "jangan dibuat satu item check
  // satu tombol" -- state-nya dipindah ke sini/parent, dipakai bareng oleh
  // tampilan "single" (1 grafik) maupun "all" (N grafik ditumpuk), lihat prop
  // `showTable` yg dikirim ke tiap `QcTrendChart` di bawah).
  const [showTable, setShowTable] = useState(false);

  const materialOptionsQuery = useQuery({
    queryKey: ["quality-check-review-materials"],
    queryFn: () => api.get<{ success: boolean; data: MaterialOption[] }>("/dashboard/quality-check-review/material-numbers").then((r) => r.data),
    enabled: tab === "trend",
  });

  const materialTrendQuery = useQuery({
    queryKey: ["quality-check-review-material-trend", selectedMaterial],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MaterialTrendData }>(`/dashboard/quality-check-review/material-trend?materialNumber=${encodeURIComponent(selectedMaterial)}`)
        .then((r) => r.data),
    enabled: selectedMaterial.length > 0,
  });

  // Tab "OK (QC Passed) - Tren" (2026-08-23, instruksi eksplisit user):
  // berapa No Order yg "OK (QC Passed)" per Harian/Mingguan/Bulanan, dalam 2
  // grafik -- jumlah Formula (Order) & Total Qty (KG/Ltr). Rentang
  // tanggal/cakupan hari (2026-08-23, follow-up instruksi eksplisit user) --
  // pola SAMA PERSIS dgn Tren Produktivitas: default "all" (tanpa filter,
  // tampilkan semua data) sampai user isi Dari/Sampai Tanggal, dan "Hari
  // Kerja Saja" cuma berlaku kalau granularitasnya "day" (bucket Mingguan/
  // Bulanan sudah gabungan hari kerja+weekend, tidak bisa dipisah per-bucket).
  const [okTrendGranularity, setOkTrendGranularity] = useState<Granularity>("day");
  const [okTrendFrom, setOkTrendFrom] = useState("");
  const [okTrendTo, setOkTrendTo] = useState("");
  const okTrendUsingCustomRange = Boolean(okTrendFrom || okTrendTo);
  const [okTrendDayScope, setOkTrendDayScope] = useState<"workdays" | "all">("workdays");

  const okTrendQuery = useQuery({
    queryKey: ["quality-check-review-ok-trend", okTrendGranularity, okTrendFrom, okTrendTo],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("granularity", okTrendGranularity);
      if (okTrendUsingCustomRange) {
        if (okTrendFrom) params.set("from", okTrendFrom);
        if (okTrendTo) params.set("to", okTrendTo);
      } else {
        params.set("period", "all");
      }
      return api.get<{ success: boolean; data: QcOkTrendData }>(`/dashboard/quality-check-review/ok-trend?${params.toString()}`).then((r) => r.data);
    },
    enabled: tab === "ok-trend",
  });

  const okTrendEffectiveDayScope = okTrendGranularity === "day" ? okTrendDayScope : "all";
  const okTrendBuckets = useMemo(() => {
    const raw = okTrendQuery.data?.buckets ?? [];
    return okTrendEffectiveDayScope === "workdays" ? raw.filter((b) => !isWeekendKey(b.bucketKey)) : raw;
  }, [okTrendQuery.data, okTrendEffectiveDayScope]);
  const okTrendPointsCount: TrendChartPoint[] = useMemo(
    () =>
      okTrendBuckets.map((b) => ({
        bucketKey: b.bucketKey,
        label: formatBucketLabel(b.bucketKey, okTrendGranularity),
        values: { ok: b.orderCount },
      })),
    [okTrendBuckets, okTrendGranularity]
  );
  const okTrendPointsQty: TrendChartPoint[] = useMemo(
    () =>
      okTrendBuckets.map((b) => ({
        bucketKey: b.bucketKey,
        label: formatBucketLabel(b.bucketKey, okTrendGranularity),
        values: { ok: b.qty },
      })),
    [okTrendBuckets, okTrendGranularity]
  );

  const itemChecks = materialTrendQuery.data?.itemChecks ?? [];
  // Item Check terpilih otomatis ke yg pertama begitu daftarnya berubah
  // (Material baru dipilih) kalau belum ada pilihan yg valid utk daftar ini.
  useEffect(() => {
    if (itemChecks.length > 0 && !itemChecks.includes(selectedItemCheck)) {
      setSelectedItemCheck(itemChecks[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemChecks]);

  const materialTrendRows = materialTrendQuery.data?.rows ?? [];

  /** Bangun titik grafik utk 1 Item Check dari histori material yg sudah
   * di-fetch -- dipakai bareng oleh tampilan "single" (1x panggil, Item
   * Check terpilih) & "all" (dipanggil per Item Check di daftar). */
  function buildPoints(itemCheck: string): QcTrendPoint[] {
    return materialTrendRows
      .filter((r) => r.itemCheck === itemCheck)
      .map((r) => ({
        key: `${r.order}-${r.timestamp}`,
        label: formatDateTime(r.timestamp),
        order: r.order,
        batch: r.batch,
        value: parseFloat(String(r.result ?? "").trim()),
        resultRaw: r.result ?? "-",
        spec: r.spec,
        verdict: evaluateSpec(r.spec, r.result, r.itemCheck),
      }))
      .filter((p) => Number.isFinite(p.value));
  }

  const trendPoints = buildPoints(selectedItemCheck);

  const materialOptions = materialOptionsQuery.data ?? [];
  const selectedMaterialDescription = materialOptions.find((m) => m.materialNumber === selectedMaterial)?.materialDescription ?? null;

  /** Dipanggil saat kolom cari Material Number blur/Enter -- cuma set
   * `selectedMaterial` (memicu fetch histori) kalau ketikannya PERSIS cocok
   * dgn salah satu Material Number di datalist saran (2026-08-23, sama pola
   * validasi dgn field2 lain di app ini yg wajib pilih dari daftar saran,
   * bukan bebas ketik apa saja). */
  function lookupMaterial() {
    const trimmed = materialNumberInput.trim();
    const match = materialOptions.find((m) => m.materialNumber.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      setMaterialNumberInput(match.materialNumber);
      setSelectedMaterial(match.materialNumber);
    }
  }

  const rows = query.data?.rows ?? [];
  const filteredRows = statusFilter.size > 0 ? rows.filter((r) => statusFilter.has(r.status)) : rows;

  const summary = { ok: 0, onCheck: 0, improve: 0, approval: 0 };
  for (const r of filteredRows) {
    if (r.status === "OK") summary.ok++;
    else if (r.status === "On Check") summary.onCheck++;
    else if (r.status === "Improve") summary.improve++;
    else if (r.status === "Approval") summary.approval++;
  }

  const statusFilterButton = (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={`btn ${showStatusPanel || statusFilter.size > 0 ? "" : "btn-outline"}`}
        onClick={() => setShowStatusPanel((s) => !s)}
      >
        ☰ Status{statusFilter.size > 0 ? ` (${statusFilter.size})` : ""}
      </button>
      {showStatusPanel && (
        <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 180, padding: 10 }}>
          {STATUS_OPTIONS.map((opt) => (
            <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={statusFilter.has(opt.value)}
                onChange={() => setStatusFilter((s) => toggleInSet(s, opt.value))}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "ringkasan" ? "" : "btn-outline"}`} onClick={() => setTab("ringkasan")}>
          Ringkasan
        </button>
        <button className={`btn ${tab === "trend" ? "" : "btn-outline"}`} onClick={() => setTab("trend")}>
          Quality Check / Material Number
        </button>
        <button className={`btn ${tab === "ok-trend" ? "" : "btn-outline"}`} onClick={() => setTab("ok-trend")}>
          OK (QC Passed) - Tren
        </button>
      </div>

      {tab === "ringkasan" && (
        <div className="panel">
          <div className="panel-header">Quality Check Review</div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard label="Total" value={filteredRows.length} color="var(--navy-light)" />
          <KpiCard label="OK (QC Passed)" value={summary.ok} color={STATUS_COLOR.OK} />
          <KpiCard label="On Check" value={summary.onCheck} color={STATUS_COLOR["On Check"]} />
          <KpiCard label="Improve" value={summary.improve} color={STATUS_COLOR.Improve} />
          <KpiCard label="Approval" value={summary.approval} color={STATUS_COLOR.Approval} />
        </div>

        <DataTable
            rowKey={(r: QualityReviewRow) => r.order}
            exportFileName="quality-check-review"
            storageKey="quality-check-review"
            rows={filteredRows}
            freezeFirstColumn
            toolbarExtraLeft={statusFilterButton}
            emptyMessage={query.isLoading ? "Memuat..." : "Belum ada Order yang masuk status ini."}
            columns={[
              { key: "order", label: "Order", render: (r) => r.order },
              { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber ?? "-" },
              { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription ?? "-" },
              { key: "batch", label: "Batch", render: (r) => r.batch ?? "-" },
              { key: "plant", label: "Plant", render: (r) => r.plant ?? "-" },
              { key: "customer", label: "Customer", render: (r) => r.customer ?? "-" },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span
                    style={{
                      background: STATUS_COLOR[r.status],
                      color: "#fff",
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      display: "inline-block",
                    }}
                  >
                    {r.status}
                  </span>
                ),
                csvValue: (r) => r.status,
              },
              { key: "adminQcStage", label: "Admin QC Stage", render: (r) => r.adminQcStage ?? "-" },
              {
                key: "qcTimestamp",
                label: "Tanggal Masuk QC",
                render: (r) => (r.qcTimestamp ? formatDateTime(r.qcTimestamp) : "-"),
                csvValue: (r) => (r.qcTimestamp ? toExcelDateTimeString(r.qcTimestamp) : ""),
              },
              {
                key: "qcPassed",
                label: "QC Passed",
                render: (r) => (r.qcPassed ? formatDateTime(r.qcPassed) : "-"),
                csvValue: (r) => (r.qcPassed ? toExcelDateTimeString(r.qcPassed) : ""),
              },
            ]}
            />
          </div>
        </div>
      )}

      {tab === "trend" && (
        <div className="panel">
          <div className="panel-header">Quality Check / Material Number</div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ maxWidth: 260 }}>
                <label>Material Number</label>
                <input
                  list="qc-trend-material-options"
                  value={materialNumberInput}
                  onChange={(e) => setMaterialNumberInput(e.target.value)}
                  onBlur={lookupMaterial}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      lookupMaterial();
                    }
                  }}
                  placeholder="Ketik/pilih Material Number..."
                />
                <datalist id="qc-trend-material-options">
                  {materialOptions.map((m) => (
                    <option key={m.materialNumber} value={m.materialNumber}>
                      {m.materialDescription ?? ""}
                    </option>
                  ))}
                </datalist>
              </div>

              {/* Material Description (2026-08-23, instruksi eksplisit user) --
                  read-only, otomatis dari Material Number terpilih (lookup ke
                  materialOptions yg sudah py materialDescription, bukan field
                  bebas ketik). */}
              {selectedMaterial && (
                <div className="field" style={{ maxWidth: 320 }}>
                  <label>Material Description</label>
                  <input value={selectedMaterialDescription ?? "-"} readOnly disabled />
                </div>
              )}

              {viewMode === "single" && itemChecks.length > 0 && (
                <div className="field" style={{ maxWidth: 220 }}>
                  <label>Item Check</label>
                  <select value={selectedItemCheck} onChange={(e) => setSelectedItemCheck(e.target.value)}>
                    {itemChecks.map((ic) => (
                      <option key={ic} value={ic}>
                        {ic}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 2 tampilan grafik (2026-08-23, instruksi eksplisit user) --
                  "Per Item Check": 1 grafik utk Item Check terpilih (dropdown
                  di atas). "Semua Item Check": SEMUA Item Check material ini
                  ditumpuk vertikal sekaligus, tanpa perlu pilih satu-satu. */}
              {itemChecks.length > 0 && (
                <div className="field" style={{ maxWidth: 260 }}>
                  <label>Tampilan</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={`btn ${viewMode === "single" ? "" : "btn-outline"}`}
                      style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                      onClick={() => setViewMode("single")}
                    >
                      Per Item Check
                    </button>
                    <button
                      type="button"
                      className={`btn ${viewMode === "all" ? "" : "btn-outline"}`}
                      style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                      onClick={() => setViewMode("all")}
                    >
                      Semua Item Check
                    </button>
                  </div>
                </div>
              )}

              {selectedMaterial && itemChecks.length > 0 && (
                <div className="field">
                  <label>&nbsp;</label>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                    onClick={() => setShowTable((s) => !s)}
                  >
                    {showTable ? "Lihat sbg Grafik" : "Lihat sbg Tabel"}
                  </button>
                </div>
              )}
            </div>

            {!selectedMaterial && (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Ketik/pilih Material Number dulu utk lihat grafik history hasil pengecekannya.
              </p>
            )}
            {selectedMaterial && materialTrendQuery.isLoading && (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>Memuat histori Material Number ini...</p>
            )}
            {selectedMaterial && !materialTrendQuery.isLoading && itemChecks.length === 0 && (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Belum ada histori Input Check Results utk Material Number ini.
              </p>
            )}

            {selectedMaterial && itemChecks.length > 0 && viewMode === "single" && selectedItemCheck && (
              <QcTrendChart points={trendPoints} valueLabel={`Result — ${selectedItemCheck}`} showTable={showTable} />
            )}

            {selectedMaterial && itemChecks.length > 0 && viewMode === "all" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {itemChecks.map((ic) => (
                  <div key={ic}>
                    <h4 style={{ margin: "0 0 6px" }}>{ic}</h4>
                    <QcTrendChart points={buildPoints(ic)} valueLabel={`Result — ${ic}`} showTable={showTable} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ok-trend" && (
        <div className="panel">
          <div className="panel-header">OK (QC Passed) - Tren</div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8 }}>
                {GRANULARITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`btn ${okTrendGranularity === opt.value ? "" : "btn-outline"}`}
                    onClick={() => setOkTrendGranularity(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="field" style={{ maxWidth: 180 }}>
                <label>Dari Tanggal</label>
                <input type="date" value={okTrendFrom} onChange={(e) => setOkTrendFrom(e.target.value)} />
              </div>
              <div className="field" style={{ maxWidth: 180 }}>
                <label>Sampai Tanggal</label>
                <input type="date" value={okTrendTo} onChange={(e) => setOkTrendTo(e.target.value)} />
              </div>
              {okTrendUsingCustomRange && (
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Rentang tanggal aktif.</span>
              )}
              {okTrendUsingCustomRange && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setOkTrendFrom("");
                    setOkTrendTo("");
                  }}
                >
                  Reset Tanggal
                </button>
              )}
            </div>

            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Cakupan hari:</span>
                <button
                  type="button"
                  className={`btn ${okTrendDayScope === "workdays" ? "" : "btn-outline"}`}
                  disabled={okTrendGranularity !== "day"}
                  onClick={() => setOkTrendDayScope("workdays")}
                >
                  Hari Kerja Saja
                </button>
                <button
                  type="button"
                  className={`btn ${okTrendDayScope === "all" ? "" : "btn-outline"}`}
                  disabled={okTrendGranularity !== "day"}
                  onClick={() => setOkTrendDayScope("all")}
                >
                  Termasuk Sabtu/Minggu
                </button>
              </div>
              {okTrendGranularity !== "day" && (
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.72rem" }}>
                  Filter Cakupan Hari cuma berlaku di granularitas Harian -- bucket Mingguan/Bulanan sudah menggabungkan
                  hari kerja & Sabtu/Minggu jadi 1 angka.
                </p>
              )}
            </div>

            {okTrendQuery.isLoading && (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>Memuat...</p>
            )}
            {!okTrendQuery.isLoading && okTrendBuckets.length === 0 && (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>Belum ada Order yang OK (QC Passed).</p>
            )}

            {okTrendBuckets.length > 0 && (
              <>
                <div className="panel" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Jumlah Formula (Order) OK (QC Passed)</div>
                  <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
                    Garis putus-putus = rata-rata jumlah Order OK per {GRANULARITY_OPTIONS.find((o) => o.value === okTrendGranularity)?.label.toLowerCase()}.
                  </p>
                  <TrendLineChart points={okTrendPointsCount} series={[OK_TREND_SERIES]} yAxisLabel="Jumlah Order" granularity={okTrendGranularity} showAverage />
                </div>

                <div className="panel" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Total Qty (KG/Ltr) OK (QC Passed)</div>
                  <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
                    Garis putus-putus = rata-rata Qty (KG/Ltr) OK per {GRANULARITY_OPTIONS.find((o) => o.value === okTrendGranularity)?.label.toLowerCase()}.
                  </p>
                  <TrendLineChart
                    points={okTrendPointsQty}
                    series={[OK_TREND_SERIES]}
                    yAxisLabel="KG/Ltr"
                    valueFormatter={(n) => n.toLocaleString("id-ID")}
                    granularity={okTrendGranularity}
                    showAverage
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
