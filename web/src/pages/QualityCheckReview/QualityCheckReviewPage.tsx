import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { evaluateSpec } from "../../lib/specEval";
import QcTrendChart, { QcTrendPoint } from "./QcTrendChart";
import TrendLineChart, { TrendChartPoint, TrendSeries } from "../ProduktivitasDashboard/TrendLineChart";

type OrderQcStatus = "OK" | "On Check" | "Improve" | "Approval" | "Assorted (NG)";

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
  sinceQcEntry: string | null;
  orderQty: string | null;
  pctGR: string | null;
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

const DAY_SCOPE_OPTIONS: { value: "workdays" | "all"; label: string }[] = [
  { value: "workdays", label: "Hari Kerja Saja" },
  { value: "all", label: "Termasuk Sabtu/Minggu" },
];

const STATUS_COLOR: Record<OrderQcStatus, string> = {
  OK: "#22c55e",
  "On Check": "#94a3b8",
  Improve: "#f59e0b",
  Approval: "#0ea5e9",
  "Assorted (NG)": "#dc2626",
};

// "Approval" SENGAJA tidak ada di daftar ini (2026-09-01, instruksi eksplisit
// user) -- status itu dikeluarkan total dari halaman ini (lihat komentar di
// tempat `rows` difilter), jadi tidak ada gunanya jadi opsi filter di sini.
const STATUS_OPTIONS: { value: OrderQcStatus; label: string }[] = [
  { value: "OK", label: "OK (QC Passed)" },
  { value: "On Check", label: "On Check" },
  { value: "Improve", label: "Improve" },
  { value: "Assorted (NG)", label: "Assorted (NG)" },
];

// Kartu KPI "Lama Proses" (2026-08-23, instruksi eksplisit user, tab
// Ringkasan; DIREVISI 2026-09-01 dua kali -- sempat dikunci ke status "On
// Check" saja, lalu diubah lagi jadi SEPENUHNYA reaktif thd kartu KPI Status
// yg diklik: klik "OK (QC Passed)" -> kartu Lama Proses & tabel detail ikut
// menampilkan SEMUA baris OK, dst -- lihat komentar `rowAgeBucket` di bawah).
// Batas bucket NON-OVERLAP secara internal
// (`maxDays`) meski label "15-21 Hari" & "21-30 Hari" sekilas tumpang tindih
// di angka 21 -- itu murni teks label sesuai kalimat eksplisit user, logika
// pembagiannya tetap tanpa duplikasi (bucket "21-30" sebenarnya menampung
// hari ke-22 s.d. 30, bukan 21).
const AGE_BUCKETS: { key: string; label: string; maxDays: number; color: string }[] = [
  { key: "1-7", label: "1-7 Hari", maxDays: 7, color: "#2ECC71" },
  { key: "8-14", label: "8-14 Hari", maxDays: 14, color: "#F1C40F" },
  { key: "15-21", label: "15-21 Hari", maxDays: 21, color: "#E67E22" },
  { key: "21-30", label: "21-30 Hari", maxDays: 30, color: "#E74C3C" },
  { key: ">30", label: ">30 Hari", maxDays: Infinity, color: "#962D22" },
];

/** Sudah berapa HARI KERJA (exclude Sabtu/Minggu) sejak `sinceIso` sampai
 * `endMs` -- DIREVISI 2026-09-01 (instruksi eksplisit user): Sabtu/Minggu
 * TIDAK DIHITUNG, berlaku ke SEMUA kartu KPI & kolom yg pakai fungsi ini
 * (Lama Proses/bucket umur/kolom tabel), bukan cuma satu tempat. Caranya:
 * hitung dulu total "unit hari" yg lewat (pola SAMA dgn sebelumnya -- ceil
 * durasi/24 jam, jadi hari yg baru mulai tetap kehitung 1 unit), lalu utk
 * tiap unit hari itu (dimulai dari tanggal `sinceIso` sendiri, hari ke-0,
 * ke-1, dst) cek hari apa itu -- Sabtu/Minggu dilewati, sisanya dihitung.
 * Pakai getter waktu LOKAL browser (bukan UTC eksplisit) -- konsisten dgn
 * `formatDateTime`/`toDateTimeLocalValue` di lib/datetime.ts yg jg pakai
 * local time getters, asumsi browser sudah di zona WIB (kantor). */
function ageDaysSince(sinceIso: string, endMs: number): number {
  const start = new Date(sinceIso);
  const totalDayUnits = Math.max(1, Math.ceil((endMs - start.getTime()) / 86_400_000));
  let workdays = 0;
  for (let i = 0; i < totalDayUnits; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dow = day.getDay(); // 0 = Minggu, 6 = Sabtu
    if (dow !== 0 && dow !== 6) workdays++;
  }
  return workdays;
}

/** Titik akhir hitungan "Lama Proses" 1 baris (2026-09-01, instruksi
 * eksplisit user) -- kalau Order-nya SUDAH SELESAI (`qcPassed` terisi, jadi
 * status "OK" ATAU "Assorted (NG)" krn keduanya mewajibkan QC Passed),
 * hitungannya BERHENTI di tanggal QC Passed (durasi proses yg SEBENARNYA,
 * tidak terus nambah walau sudah lama selesai). Order yg MASIH BERJALAN
 * (On Check/Improve, belum py QC Passed) tetap dihitung sampai SEKARANG,
 * spt sebelumnya. Sengaja dicek dari `qcPassed`, BUKAN dari `status` --
 * biar generik & otomatis benar utk status apa pun yg kelak mewajibkan QC
 * Passed juga, tidak perlu daftar status manual di sini. */
function rowAgeEndMs(r: QualityReviewRow, nowMs: number): number {
  return r.qcPassed ? new Date(r.qcPassed).getTime() : nowMs;
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Qty di `orderQty` adalah free-text (dari MasterOrder/AdminQc) -- pola
 * parsing SAMA dgn `parseQtyNumber` server (lib/qty.ts) & `parseQtyLocal` di
 * MillingPage.tsx, diduplikasi lokal per konvensi codebase ini. */
function parseQtyLocal(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const numberFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/** Kartu KPI (2026-08-23, instruksi eksplisit user) -- ukuran & layout
 * dikembalikan sedekat mungkin ke kartu aslinya SEBELUM fitur Qty
 * ditambahkan: label judul kartu (mis. "OK (QC Passed)") sejajar 1 baris
 * dgn "Qty (Ltr): X" (kecil, kanan) supaya tidak nambah tinggi kartu, lalu
 * label "Qty Formula" (kecil) DI ATAS angka besarnya (bukan di bawah). */
/** Kartu KPI bisa diklik utk filter tabel di bawahnya (2026-08-27, instruksi
 * eksplisit user) -- `onClick` opsional supaya kartu di tempat lain (kalau
 * ada) yg tidak dikasih handler tetap tampil apa adanya, tidak clickable.
 * `active` = kartu ini SEDANG jadi bagian filter yg aktif (ring warna sesuai
 * kartu). `dimmed` = ADA filter aktif di grup kartu ini tapi BUKAN kartu ini
 * (diredupkan supaya kartu yg aktif lebih menonjol) -- dua prop ini sengaja
 * independen (bukan turunan satu sama lain) supaya pemanggil bebas atur
 * logika grupnya sendiri (Status vs Lama Proses, masing2 grup terpisah). */
function KpiCard({
  label,
  count,
  qty,
  color,
  onClick,
  active,
  dimmed,
}: {
  label: string;
  count: number;
  qty: number;
  color: string;
  onClick?: () => void;
  active?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div
      className="panel"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{
        flex: "1 1 160px",
        padding: 16,
        borderTop: `4px solid ${color}`,
        cursor: onClick ? "pointer" : undefined,
        boxShadow: active ? `0 0 0 2px ${color}` : undefined,
        opacity: dimmed ? 0.55 : 1,
        transition: "opacity 0.15s ease, box-shadow 0.15s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          Qty (Ltr): <span style={{ fontWeight: 600, color: "var(--navy-dark)" }}>{numberFmt.format(qty)}</span>
        </div>
      </div>
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Qty Formula</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{count}</div>
    </div>
  );
}

/**
 * Dashboard > Quality Check Review (2026-08-23, REVISI TOTAL sesuai instruksi
 * eksplisit user -- versi lama merekap per-baris Spec Parameter/verdict
 * OK-NG, DIGANTI TOTAL jadi rekap per NO ORDER dgn status kerja QC ("Assorted
 * (NG)" ditambahkan 2026-09-01, instruksi eksplisit user). Logika lengkap
 * penentuan status ada di backend (dashboard.routes.ts) -- halaman ini murni
 * menampilkan hasilnya:
 *   - "OK"            : Order sudah py "QC Passed" (kolom qcPassed di AdminQc).
 *   - "Approval"      : belum QC Passed, Admin QC Stage TERBARU = "Approval".
 *   - "Improve"        : belum QC Passed, Admin QC Stage TERBARU = "Improve".
 *   - "Assorted (NG)" : belum QC Passed, Admin QC Stage TERBARU = "Assorted (NG)".
 *   - "On Check"      : belum QC Passed, Admin QC Stage TERBARU BUKAN
 *                        Approval/Improve/Assorted (NG), TAPI sudah py
 *                        minimal 1 baris Input Check Results (sudah masuk
 *                        antrian QC).
 *
 * Filter "Status" (2026-08-23, follow-up instruksi eksplisit user, DIREVISI
 * lagi sesuai instruksi eksplisit user berikutnya: tombolnya dibuat SAMA spt
 * tombol "Kolom" bawaan DataTable & sejajar dgn Kolom/Filter/Reset Kolom
 * dalam 1 baris -- pola sama persis dgn filter "TA/TB"/"Status Tanki" di
 * TankDashboardPage.tsx, dirender lewat prop `toolbarExtraLeft` DataTable)
 * -- multi-select, tidak ada yg dicentang = tampilkan semua. Kartu KPI (Total
 * + tiap status) SENGAJA dihitung dari `filteredRows` (baris SETELAH
 * difilter Status), BUKAN dari total keseluruhan tanpa filter -- supaya
 * begitu user filter, kartu KPI ikut "berubah sesuai apa yang dipilih"
 * (kartu status yg tidak dicentang otomatis jadi 0) -- ini behavior yg
 * diminta eksplisit, bukan bug.
 */
export default function QualityCheckReviewPage() {
  const [tab, setTab] = useState<"ringkasan" | "trend" | "ok-trend">("ringkasan");
  const [statusFilter, setStatusFilter] = useState<Set<OrderQcStatus>>(new Set());
  const [showStatusPanel, setShowStatusPanel] = useState(false);
  // Filter "Lama Menunggu" (2026-08-23, instruksi eksplisit user) -- tombol
  // sama gayanya dgn "☰ Status", tapi memfilter berdasarkan bucket umur
  // (AGE_BUCKETS.key). Memilih 1+ bucket otomatis cuma nyisain Order yg
  // BELUM OK & py `sinceQcEntry` (Order OK/tanpa sinceQcEntry tidak py umur,
  // jadi tidak pernah cocok bucket manapun begitu filter ini aktif).
  const [ageFilter, setAgeFilter] = useState<Set<string>>(new Set());
  const [showAgePanel, setShowAgePanel] = useState(false);
  // Range waktu "Dari - Sampai" (2026-09-03, instruksi eksplisit user) --
  // filter berdasar "Tanggal Masuk QC" (sinceQcEntry). String kosong = tanpa
  // batas.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
  // grafik -- jumlah Formula (Order) & Total Qty (KG/Ltr). Rentang tanggal
  // (Dari/Sampai Tanggal) tetap ADA -- sempat dihapus total lalu instruksi
  // eksplisit user berikutnya cuma minta LABEL teksnya yg dihilangkan, field
  // input-nya dikembalikan (lihat `aria-label` di JSX, gantiin `<label>`
  // visual yg dihapus, biar tetap accessible). Default "all" (tanpa filter)
  // sampai user isi Dari/Sampai Tanggal. "Hari Kerja Saja" cuma berlaku kalau
  // granularitasnya "day" (bucket Mingguan/Bulanan sudah gabungan hari
  // kerja+weekend, tidak bisa dipisah per-bucket).
  const [okTrendGranularity, setOkTrendGranularity] = useState<Granularity>("day");
  const [okTrendFrom, setOkTrendFrom] = useState("");
  const [okTrendTo, setOkTrendTo] = useState("");
  const okTrendUsingCustomRange = Boolean(okTrendFrom || okTrendTo);
  const [okTrendDayScope, setOkTrendDayScope] = useState<"workdays" | "all">("workdays");
  const [showDayScopePanel, setShowDayScopePanel] = useState(false);

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

  const nowMs = Date.now();
  /** Bucket umur 1 row, atau `null` kalau belum py `sinceQcEntry` sama sekali
   * -- DIREVISI 2026-09-01 (instruksi eksplisit user, 3x): (1) sempat
   * dikunci ke status "On Check" saja, (2) lalu diubah jadi SEPENUHNYA
   * reaktif ke kartu KPI Status yg diklik (via `statusFilter` ->
   * `filteredRows`, fungsi ini dipanggil per baris di situ) TANPA
   * pengecualian status, (3) titik akhir hitungannya SEKARANG pakai
   * `rowAgeEndMs` (berhenti di QC Passed kalau sudah selesai, bukan terus
   * jalan sampai sekarang) DAN Sabtu/Minggu tidak dihitung (lihat
   * `ageDaysSince`). Dipakai bareng oleh perhitungan kartu KPI & filter
   * "☰ Lama Proses" di bawah, supaya 1 logika saja. */
  function rowAgeBucket(r: QualityReviewRow): string | null {
    if (!r.sinceQcEntry) return null;
    const ageDays = ageDaysSince(r.sinceQcEntry, rowAgeEndMs(r, nowMs));
    return (AGE_BUCKETS.find((b) => ageDays <= b.maxDays) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).key;
  }

  // Status "Approval" DIKELUARKAN TOTAL dari halaman ini (2026-09-01, instruksi
  // eksplisit user: sudah ada Dashboard Approval sendiri yg jauh lebih detail
  // -- awalnya cuma kartu KPI-nya yg dihapus, TAPI direvisi lagi supaya
  // sekalian tidak ikut kehitung ke kartu "Total" & tidak ada lagi di opsi
  // "☰ Status") -- difilter di sini, SEBELUM `filteredRows`, supaya
  // konsisten ke SEMUA turunannya (kartu Total/Status/Lama Proses, tabel
  // detail, Export CSV) dalam 1 titik saja.
  const rows = (query.data?.rows ?? [])
    .filter((r) => r.status !== "Approval")
    // Range waktu "Dari - Sampai" (2026-09-03, instruksi eksplisit user) --
    // filter berdasar "Tanggal Masuk QC" (sinceQcEntry), diletakkan di sini
    // (bareng exclude "Approval" di atas) supaya konsisten ke SEMUA turunan
    // (kartu Total/Status/Lama Proses, tabel detail, Export CSV).
    .filter((r) => {
      if (!dateFrom && !dateTo) return true;
      if (!r.sinceQcEntry) return false;
      const d = r.sinceQcEntry.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  const filteredRows = rows
    .filter((r) => statusFilter.size === 0 || statusFilter.has(r.status))
    .filter((r) => ageFilter.size === 0 || ageFilter.has(rowAgeBucket(r) ?? ""));

  // Tiap kartu KPI skrg py 2 metrik (2026-08-23, instruksi eksplisit user):
  // "Jumlah Formula (Order)" (jumlah baris, spt sebelumnya) & "Total Qty
  // (KG/Ltr)" (jumlah `orderQty` baris2 itu, lewat `parseQtyLocal`).
  const zeroMetric = () => ({ count: 0, qty: 0 });
  const summary = { ok: zeroMetric(), onCheck: zeroMetric(), improve: zeroMetric(), assortedNg: zeroMetric() };
  for (const r of filteredRows) {
    const bucket =
      r.status === "OK"
        ? summary.ok
        : r.status === "On Check"
        ? summary.onCheck
        : r.status === "Improve"
        ? summary.improve
        : summary.assortedNg;
    bucket.count++;
    bucket.qty += parseQtyLocal(r.orderQty);
  }
  const total = filteredRows.reduce(
    (acc, r) => ({ count: acc.count + 1, qty: acc.qty + parseQtyLocal(r.orderQty) }),
    zeroMetric()
  );

  // Kartu KPI "Lama Proses" (2026-08-23, instruksi eksplisit user; DIREVISI
  // 2x 2026-09-01, lihat komentar `rowAgeBucket` di atas) -- dihitung dari
  // `filteredRows` (sama konvensi reaktif-thd-filter Status/Lama Proses dgn
  // kartu2 lain), pakai `rowAgeBucket` yg sama dgn yg dipakai filter di atas
  // (1 sumber logika).
  const ageBuckets: Record<string, { count: number; qty: number }> = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, zeroMetric()]));
  for (const r of filteredRows) {
    const bucket = rowAgeBucket(r);
    if (bucket) {
      ageBuckets[bucket].count++;
      ageBuckets[bucket].qty += parseQtyLocal(r.orderQty);
    }
  }
  const ageTotal = Object.values(ageBuckets).reduce(
    (acc, b) => ({ count: acc.count + b.count, qty: acc.qty + b.qty }),
    zeroMetric()
  );

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

  const ageFilterButton = (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={`btn ${showAgePanel || ageFilter.size > 0 ? "" : "btn-outline"}`}
        onClick={() => setShowAgePanel((s) => !s)}
      >
        ☰ Lama Proses{ageFilter.size > 0 ? ` (${ageFilter.size})` : ""}
      </button>
      {showAgePanel && (
        <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 180, padding: 10 }}>
          {AGE_BUCKETS.map((opt) => (
            <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={ageFilter.has(opt.key)}
                onChange={() => setAgeFilter((s) => toggleInSet(s, opt.key))}
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
            {/* Range waktu "Dari - Sampai" (2026-09-03, instruksi eksplisit
                user) -- filter berdasar "Tanggal Masuk QC", berlaku ke SEMUA
                kartu KPI/tabel/Export CSV di bawah (bagian dari `rows`). */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: "0.8rem" }}>
              <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>Range waktu (Tanggal Masuk QC):</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: 160 }} />
              <span style={{ color: "var(--text-muted)" }}>s/d</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: 160 }} />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  ✕ Reset tanggal
                </button>
              )}
            </div>

            {/* Klik kartu KPI Status utk filter tabel di bawah (2026-08-27,
                instruksi eksplisit user) -- toggle langsung ke `statusFilter`,
                state YANG SAMA dipakai tombol "☰ Status" & tabel `filteredRows`
                di bawah, jadi otomatis sinkron 2 arah (klik kartu = ikut
                tercentang di panel Status, & sebaliknya). "Total" me-reset
                filter (tampilkan semua), kartu lain toggle statusnya sendiri
                masuk/keluar dari `statusFilter` (bisa pilih lebih dari 1).
                Kartu "Approval" DIHAPUS 2026-09-01 (instruksi eksplisit user
                -- sudah ada Dashboard Approval sendiri yg jauh lebih detail,
                kartu ini dirasa mubazir) -- status "Approval" sendiri TETAP
                ada (masih dihitung ke "Total", masih bisa difilter lewat
                "☰ Status", masih tampil di tabel detail & badge Status),
                cuma kartu KPI dedicated-nya yg hilang. */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard
            label="Total"
            count={total.count}
            qty={total.qty}
            color="#3498DB"
            onClick={() => setStatusFilter(new Set())}
            active={statusFilter.size === 0}
            dimmed={statusFilter.size > 0}
          />
          <KpiCard
            label="OK (QC Passed)"
            count={summary.ok.count}
            qty={summary.ok.qty}
            color="#2ECC71"
            onClick={() => setStatusFilter((s) => toggleInSet(s, "OK"))}
            active={statusFilter.has("OK")}
            dimmed={statusFilter.size > 0 && !statusFilter.has("OK")}
          />
          <KpiCard
            label="On Check"
            count={summary.onCheck.count}
            qty={summary.onCheck.qty}
            color="#F1C40F"
            onClick={() => setStatusFilter((s) => toggleInSet(s, "On Check"))}
            active={statusFilter.has("On Check")}
            dimmed={statusFilter.size > 0 && !statusFilter.has("On Check")}
          />
          <KpiCard
            label="Improve"
            count={summary.improve.count}
            qty={summary.improve.qty}
            color="#E74C3C"
            onClick={() => setStatusFilter((s) => toggleInSet(s, "Improve"))}
            active={statusFilter.has("Improve")}
            dimmed={statusFilter.size > 0 && !statusFilter.has("Improve")}
          />
          <KpiCard
            label="Assorted (NG)"
            count={summary.assortedNg.count}
            qty={summary.assortedNg.qty}
            color="#E74C3C"
            onClick={() => setStatusFilter((s) => toggleInSet(s, "Assorted (NG)"))}
            active={statusFilter.has("Assorted (NG)")}
            dimmed={statusFilter.size > 0 && !statusFilter.has("Assorted (NG)")}
          />
        </div>

        <div>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>Lama Proses</div>
          {/* Sama pola dgn kartu Status di atas, tapi toggle ke `ageFilter`
              (state yg sama dgn tombol "☰ Lama Proses") -- 2 grup kartu ini
              SENGAJA independen (AND, bukan saling reset), sama spt 2 panel
              filternya yg juga independen. */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiCard
              label="Total"
              count={ageTotal.count}
              qty={ageTotal.qty}
              color="#3498DB"
              onClick={() => setAgeFilter(new Set())}
              active={ageFilter.size === 0}
              dimmed={ageFilter.size > 0}
            />
            {AGE_BUCKETS.map((b) => (
              <KpiCard
                key={b.key}
                label={b.label}
                count={ageBuckets[b.key].count}
                qty={ageBuckets[b.key].qty}
                color={b.color}
                onClick={() => setAgeFilter((s) => toggleInSet(s, b.key))}
                active={ageFilter.has(b.key)}
                dimmed={ageFilter.size > 0 && !ageFilter.has(b.key)}
              />
            ))}
          </div>
        </div>

        <DataTable
            rowKey={(r: QualityReviewRow) => r.order}
            exportFileName="quality-check-review"
            storageKey="quality-check-review"
            rows={filteredRows}
            freezeFirstColumn
            toolbarExtraLeft={
              <div style={{ display: "flex", gap: 8 }}>
                {statusFilterButton}
                {ageFilterButton}
              </div>
            }
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
              {
                // Kolom "Lama Proses" per baris (2026-09-01, instruksi eksplisit
                // user, sebelah "QC Passed") -- angka hari yg SAMA PERSIS dgn
                // yg dipakai kartu KPI "Lama Proses" di atas (`ageDaysSince` +
                // `rowAgeEndMs`, lihat komentar `rowAgeBucket`: berhenti di QC
                // Passed kalau sudah selesai, Sabtu/Minggu tidak dihitung),
                // cuma di sini ditampilkan sbg angka per-Order, bukan digroup
                // ke bucket.
                key: "ageDays",
                label: "Lama Proses (Hari)",
                render: (r) => (r.sinceQcEntry ? `${ageDaysSince(r.sinceQcEntry, rowAgeEndMs(r, nowMs))} hari` : "-"),
                csvValue: (r) => (r.sinceQcEntry ? ageDaysSince(r.sinceQcEntry, rowAgeEndMs(r, nowMs)) : ""),
              },
              { key: "pctGR", label: "% GR", render: (r) => r.pctGR ?? "-" },
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
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`btn ${showDayScopePanel ? "" : "btn-outline"}`}
                  disabled={okTrendGranularity !== "day"}
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
                          name="ok-trend-day-scope"
                          checked={okTrendDayScope === opt.value}
                          onChange={() => setOkTrendDayScope(opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
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
                <input type="date" aria-label="Dari Tanggal" value={okTrendFrom} onChange={(e) => setOkTrendFrom(e.target.value)} />
              </div>
              <div className="field" style={{ maxWidth: 180 }}>
                <input type="date" aria-label="Sampai Tanggal" value={okTrendTo} onChange={(e) => setOkTrendTo(e.target.value)} />
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

            {okTrendGranularity !== "day" && (
              <p style={{ margin: 0, marginTop: -12, color: "var(--text-muted)", fontSize: "0.72rem" }}>
                Filter Cakupan Hari cuma berlaku di granularitas Harian -- bucket Mingguan/Bulanan sudah menggabungkan
                hari kerja & Sabtu/Minggu jadi 1 angka.
              </p>
            )}

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
