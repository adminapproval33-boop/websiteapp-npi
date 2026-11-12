import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import TrendLineChart, { TrendChartPoint, TrendSeries } from "./TrendLineChart";
import TrendBarChart from "./TrendBarChart";

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
  /** Jumlah FISIK seluruh tanki, TERMASUK yg Damaged (2026-09-23, REVISI
   * instruksi eksplisit user -- sebelumnya tidak termasuk Damaged, sekarang
   * "Tanki Aktif" di bawah yg jadi kolom terpisah utk itu). */
  total: number;
  /** Jumlah tanki yg TIDAK Damaged (aktif/bisa dipakai) -- inilah acuan
   * Kosong/Terisi/%Terisi di bawah, BUKAN `total`. */
  aktif: number;
  terisi: number;
  kosong: number;
  /** Ditandai lewat checkbox "Damaged" di Master Data > Tanki -- dikeluarkan
   * dari aktif/kosong/terisi/%Terisi krn bukan kapasitas yg benar2 bisa
   * dipakai, TAPI tetap ikut dihitung di `total` (jumlah fisik). */
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
/** Tab "RFT Quality Check" & "RFT Approval" (2026-11-11, instruksi eksplisit
 * user) -- 2 panel tambahan di halaman yg sama, ikut filter Harian/Mingguan/
 * Bulanan + Dari/Sampai Tanggal yg sudah ada. Definisi (disetujui user):
 * RFT QC = Order OK (QC Passed) yg SEMUA histori Check Results-nya Pass sejak
 * awal (SAMA PERSIS "Direct Passed" di Dashboard Quality, lihat
 * /dashboard/produktivitas-rft di backend -- 1 sumber kebenaran); RFT
 * Approval = Order Oke Approval (Finish App terisi) yg TIDAK PERNAH ditandai
 * Improve ("Trial N (NG)" di Remark / flag needsImprove). */
type DashboardTab = "ringkasan" | "tren" | "rftQc" | "rftApproval";

interface RftBucket {
  bucketKey: string;
  total: number;
  direct: number;
  notDirect: number;
}

interface RftSection {
  total: number;
  direct: number;
  notDirect: number;
  buckets: RftBucket[];
}

interface RftData {
  granularity: Granularity;
  qc: RftSection;
  approval: RftSection;
}

const RFT_SERIES_QC: TrendSeries[] = [
  { key: "direct", label: "Direct Passed", color: "#1baf7a" },
  { key: "notDirect", label: "Not Direct Passed", color: "#eb6834" },
];
const RFT_SERIES_APPROVAL: TrendSeries[] = [
  { key: "direct", label: "Oke Approval tanpa Improve", color: "#1baf7a" },
  { key: "notDirect", label: "Pernah Improve", color: "#eb6834" },
];
const RFT_RATE_SERIES: TrendSeries[] = [{ key: "rate", label: "RFT Rate (%)", color: "#2a78d6" }];

/** Satu panel RFT (dipakai 2x: QC & Approval) -- kartu KPI (total 1 tahun) +
 * 2 diagram batang per BULAN utk 1 tahun yg dipilih, FORMAT SAMA PERSIS dgn
 * "Laporan Dashboard Approval" yg dikirim tiap pagi (approvalReportSlide.ts,
 * 2026-11-12 instruksi eksplisit user): batang berdampingan per bulan mulai
 * dari bulan pertama yg py data s.d. Desember, ditambah 1 kolom "Ytd.YY"
 * (total setahun) di paling kanan, angka nilai di atas tiap batang. BUKAN
 * ikut filter Harian/Mingguan/Bulanan + Dari/Sampai Tanggal halaman ini. */
function RftPanel({
  title,
  description,
  section,
  series,
  year,
  showTable,
  variant,
}: {
  title: string;
  description: string;
  section: RftSection | undefined;
  series: TrendSeries[];
  year: number;
  showTable: boolean;
  /** Menentukan isi popup "!" cara menghitung (QC vs Approval). */
  variant: "qc" | "approval";
}) {
  const ytdLabel = `Ytd.${String(year).slice(-2)}`;
  // Popup "!" cara menghitung (2026-11-12, instruksi eksplisit user) -- 1 per
  // grafik, isinya beda utk grafik Jumlah Order vs RFT Rate.
  const [infoOpen, setInfoOpen] = useState<"count" | "rate" | null>(null);
  const { countPoints, ratePoints, total, direct, notDirect } = useMemo(() => {
    const byMonth = new Map<number, RftBucket>();
    for (const b of section?.buckets ?? []) byMonth.set(Number(b.bucketKey.slice(5, 7)) - 1, b);
    // Mulai dari bulan PERTAMA yg py data (sama spt laporan: tidak menampilkan
    // deretan bulan kosong di awal tahun), kalau kosong semua tampilkan Des saja.
    let firstIdx = 11;
    for (const idx of byMonth.keys()) if (idx < firstIdx) firstIdx = idx;
    const monthIdx: number[] = [];
    for (let i = firstIdx; i <= 11; i++) monthIdx.push(i);
    let t = 0;
    let d = 0;
    const countPoints: TrendChartPoint[] = monthIdx.map((i) => {
      const b = byMonth.get(i);
      t += b?.total ?? 0;
      d += b?.direct ?? 0;
      return { bucketKey: `${year}-${String(i + 1).padStart(2, "0")}`, label: MONTHS_ID[i], values: { direct: b?.direct ?? 0, notDirect: b?.notDirect ?? 0 } };
    });
    countPoints.push({ bucketKey: `${year}-ytd`, label: ytdLabel, values: { direct: d, notDirect: t - d } });
    const ratePoints: TrendChartPoint[] = countPoints.map((p) => {
      const tot = p.values.direct + p.values.notDirect;
      return { bucketKey: p.bucketKey, label: p.label, values: { rate: tot > 0 ? Math.round((p.values.direct / tot) * 1000) / 10 : 0 } };
    });
    return { countPoints, ratePoints, total: t, direct: d, notDirect: t - d };
  }, [section, year, ytdLabel]);
  const rate = total > 0 ? Math.round((direct / total) * 1000) / 10 : 0;

  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.78rem" }}>{description}</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <KpiCard label={`Total Selesai (${ytdLabel})`} value={total} color="var(--navy-light)" />
        <KpiCard label={series[0].label} value={direct} color={series[0].color} />
        <KpiCard label={series[1].label} value={notDirect} color={series[1].color} />
        <KpiCard label="RFT Rate" value={`${rate.toFixed(1)}%`} color="#9b59b6" />
      </div>
      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 4 }}>
          <span>{title} -- Jumlah Order per Bulan {year}</span>
          <RftInfoButton onClick={() => setInfoOpen("count")} />
        </div>
        <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
          Batang berdampingan per bulan; kolom {ytdLabel} = total sepanjang tahun (year-to-date). Format sama dengan
          Laporan Dashboard Approval harian.
        </p>
        <TrendBarChart points={countPoints} series={series} yAxisLabel="Jumlah Order" showTable={showTable} />
      </div>
      <div className="panel" style={{ padding: 16, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 4 }}>
          <span>{title} -- RFT Rate per Bulan {year}</span>
          <RftInfoButton onClick={() => setInfoOpen("rate")} />
        </div>
        <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
          RFT Rate = {series[0].label} / Total Selesai x 100%, per bulan; kolom {ytdLabel} = rate sepanjang tahun.
        </p>
        <TrendBarChart
          points={ratePoints}
          series={RFT_RATE_SERIES}
          yAxisLabel="%"
          valueFormatter={(n) => `${n.toLocaleString("id-ID")}%`}
          showTable={showTable}
          yMax={100}
        />
      </div>

      {infoOpen && (
        <Modal
          title={`Cara menghitung: ${title} -- ${infoOpen === "count" ? "Jumlah Order" : "RFT Rate"} per Bulan ${year}`}
          onClose={() => setInfoOpen(null)}
          width={640}
        >
          <RftHowTo variant={variant} kind={infoOpen} series={series} ytdLabel={ytdLabel} />
        </Modal>
      )}
    </>
  );
}

function RftInfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Lihat cara menghitung angka di grafik ini"
      aria-label="Cara menghitung"
      style={{
        width: 20,
        height: 20,
        borderRadius: 999,
        border: "1.5px solid var(--navy)",
        background: "#fff",
        color: "var(--navy)",
        fontWeight: 800,
        fontSize: "0.78rem",
        lineHeight: 1,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      !
    </button>
  );
}

/** Isi popup "!" -- penjelasan langkah demi langkah angka di grafik RFT
 * (2026-11-12, instruksi eksplisit user). Harus selalu SEJALAN dgn logika
 * nyata di backend `buildRftData` (dashboard.routes.ts) -- kalau rumusnya
 * diubah di sana, teks ini ikut diperbarui. */
function RftHowTo({ variant, kind, series, ytdLabel }: { variant: "qc" | "approval"; kind: "count" | "rate"; series: TrendSeries[]; ytdLabel: string }) {
  const ok = series[0].label;
  const notOk = series[1].label;
  const li: React.CSSProperties = { marginBottom: 8, lineHeight: 1.5 };
  const code: React.CSSProperties = { fontFamily: "ui-monospace, Consolas, monospace", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: "0.82rem" };
  return (
    <div style={{ fontSize: "0.88rem", color: "var(--text-main)" }}>
      <ol style={{ paddingLeft: 22, margin: 0, listStyle: "decimal outside" }}>
        <li style={li}>
          <strong>Order mana yang dihitung ("Total Selesai")</strong>
          <br />
          {variant === "qc" ? (
            <>
              Hanya Order yang sudah <strong>OK (QC Passed)</strong>: diambil baris <em>Input Admin QC terbaru</em> per Order, dan
              kolom <strong>QC Passed</strong>-nya harus terisi. Order yang masih On Check / Improve / Assorted (NG) / Approval
              tidak ikut dihitung.
            </>
          ) : (
            <>
              Hanya Order yang sudah <strong>Oke Approval</strong>: diambil baris <em>Approval (Lot History) terbaru</em> per Order,
              dan kolom <strong>Finish App</strong>-nya harus terisi. Order yang masih Prepare / Wait Approval / Approval tidak ikut
              dihitung.
            </>
          )}{" "}
          Order <strong>Teco</strong> (%GR = 9999% di Master Data Cooispi) selalu dikeluarkan.
        </li>
        <li style={li}>
          <strong>Menentukan "{ok}" vs "{notOk}"</strong>
          <br />
          {variant === "qc" ? (
            <>
              Sistem membuka <strong>seluruh riwayat Input Check Results</strong> Order itu (semua percobaan sejak awal, bukan hanya
              input terakhir) dan memeriksa tiap Item Check terhadap Spec-nya (rentang, &le;/&ge;, toleransi &plusmn;, aturan
              HARDNESS, dll). Kalau <strong>tidak ada satu pun</strong> yang pernah NG &rarr; <strong>{ok}</strong>. Kalau
              <strong> ada minimal satu</strong> yang pernah NG di percobaan mana pun &rarr; <strong>{notOk}</strong>, walaupun
              akhirnya Order itu OK. Definisi ini sama persis dengan kartu RFT di Dashboard Quality.
            </>
          ) : (
            <>
              Order dianggap <strong>{ok}</strong> kalau selama proses Approval <strong>tidak pernah</strong> ditandai Improve:
              flag Improve tidak aktif <em>dan</em> di Remark-nya tidak ada jejak <span style={code}>Trial N (NG)</span> (jejak
              ini ditulis otomatis setiap tombol Improve dinyalakan). Kalau pernah &rarr; <strong>{notOk}</strong>, walaupun
              akhirnya Oke Approval.
            </>
          )}
        </li>
        <li style={li}>
          <strong>Dikelompokkan per bulan</strong>
          <br />
          Setiap Order masuk ke bulan tanggal{" "}
          {variant === "qc" ? <strong>QC Passed</strong> : <strong>Finish App</strong>}-nya (bukan tanggal Order dibuat / tanggal
          input lainnya). Grafik dimulai dari bulan pertama yang punya data sampai Desember.
        </li>
        {kind === "count" ? (
          <li style={li}>
            <strong>Angka di atas batang</strong>
            <br />
            Batang hijau = jumlah Order <strong>{ok}</strong> bulan itu; batang oranye = jumlah Order <strong>{notOk}</strong> bulan
            itu. Jumlah keduanya = Total Selesai bulan itu.
          </li>
        ) : (
          <li style={li}>
            <strong>Rumus RFT Rate per bulan</strong>
            <br />
            <span style={code}>
              RFT Rate = {ok} bulan itu &divide; Total Selesai bulan itu &times; 100%
            </span>
            <br />
            Contoh: 18 {ok} dari 20 Total Selesai &rarr; 18 &divide; 20 &times; 100% = <strong>90,0%</strong>.
          </li>
        )}
        <li style={li}>
          <strong>Kolom "{ytdLabel}" (year-to-date)</strong>
          <br />
          {kind === "count" ? (
            <>Penjumlahan seluruh bulan dalam tahun ini: &Sigma; {ok} dan &Sigma; {notOk} Jan&ndash;Des.</>
          ) : (
            <>
              <strong>Bukan</strong> rata-rata dari persentase bulanan, tetapi dihitung ulang dari total setahun:{" "}
              <span style={code}>
                &Sigma; {ok} Jan&ndash;Des &divide; &Sigma; Total Selesai Jan&ndash;Des &times; 100%
              </span>
              . Bulan dengan Order lebih banyak otomatis berbobot lebih besar &mdash; angka ini sama dengan kartu KPI "RFT Rate"
              di atas.
            </>
          )}
        </li>
      </ol>
    </div>
  );
}

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
  // Tahun utk tab RFT (2026-11-12, instruksi eksplisit user: tampilan per
  // bulan 1 tahun penuh spt Laporan Dashboard Approval harian) -- pilihan
  // tahun berjalan s.d. 2 tahun ke belakang, sama pola pemilih tahun grafik
  // "RFT Rate per Bulan (Tahunan)" di Dashboard Quality.
  const [rftYear, setRftYear] = useState(() => new Date().getFullYear());
  const rftYearOptions = [0, 1, 2].map((d) => new Date().getFullYear() - d);
  const isRftTab = dashboardTab === "rftQc" || dashboardTab === "rftApproval";
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

  // RFT QC & Approval (2026-11-11, instruksi eksplisit user) -- 1 request
  // utk kedua tab (sumber data beda tapi parameter rentang/granularitas
  // sama), cuma di-fetch pas salah satu tab RFT dibuka.
  // SELALU 1 tahun penuh (Jan-Des `rftYear`) per bulan -- TIDAK ikut
  // period/customFrom/customTo/granularity halaman (lihat komentar RftPanel).
  const rftQuery = useQuery({
    queryKey: ["dashboard-produktivitas-rft", rftYear],
    queryFn: () =>
      api
        .get<{ success: boolean; data: RftData }>(`/dashboard/produktivitas-rft?from=${rftYear}-01-01&to=${rftYear}-12-31&granularity=month`)
        .then((r) => r.data),
    enabled: isRftTab,
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
  const totalAktif = tankOccupancy.reduce((sum, r) => sum + r.aktif, 0);
  const totalTerisi = tankOccupancy.reduce((sum, r) => sum + r.terisi, 0);
  const overallPercentTerisi = totalAktif > 0 ? Math.round((totalTerisi / totalAktif) * 100) : 0;

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
          <button type="button" className={`btn ${dashboardTab === "rftQc" ? "" : "btn-outline"}`} onClick={() => setDashboardTab("rftQc")}>
            RFT Quality Check
          </button>
          <button
            type="button"
            className={`btn ${dashboardTab === "rftApproval" ? "" : "btn-outline"}`}
            onClick={() => setDashboardTab("rftApproval")}
          >
            RFT Approval
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
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
          {dashboardTab !== "ringkasan" && (
            <button type="button" className="btn btn-outline" onClick={() => setShowTrendTable((s) => !s)}>
              {showTrendTable ? "Lihat sbg Grafik" : "Lihat sbg Tabel"}
            </button>
          )}
          {/* Tab RFT: pemilih TAHUN saja (grafik selalu per bulan Jan-Des tahun
              itu, spt Laporan Dashboard Approval) -- filter granularitas &
              rentang tanggal halaman ini tidak berlaku di sana. */}
          {isRftTab ? (
            <div className="field" style={{ gap: 4 }}>
              <label style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)" }}>Tahun</label>
              <select value={rftYear} onChange={(e) => setRftYear(Number(e.target.value))} style={{ width: 110 }}>
                {rftYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        {dashboardTab === "ringkasan" && (
        <>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <KpiCard label="Total Qty Diproses (KG/Ltr)" value={numberFmt.format(totalQtyDiproses)} color="var(--navy-light)" />
          <KpiCard label="Total Tanki" value={totalTanki} color="var(--navy-light)" />
          <KpiCard label="Tanki Aktif" value={totalAktif} color="var(--navy-light)" />
          <KpiCard label="Tanki Terisi" value={totalTerisi} color="var(--danger)" />
          <KpiCard label="Tanki Kosong" value={totalAktif - totalTerisi} color="var(--success)" />
          <KpiCard label="% Terisi Keseluruhan" value={`${overallPercentTerisi}%`} color="#d97706" />
        </div>

        <h3 style={{ marginBottom: 4 }}>Okupansi Tanki per Plant</h3>
        <p style={{ marginTop: 0, marginBottom: 8, color: "var(--text-muted)", fontSize: "0.78rem" }}>
          Menampilkan kondisi tanki <strong>saat ini</strong> (real-time, sama dengan Dashboard &gt; Tank Monitoring) --
          tombol periode/rentang tanggal di atas TIDAK berpengaruh ke tabel ini. <strong>Total Tanki</strong> adalah
          jumlah fisik seluruh tanki (termasuk yang <strong>Damaged</strong>). Tanki yang ditandai Damaged (Master
          Data &gt; Tanki) dikeluarkan dari <strong>Tanki Aktif</strong>/Kosong/Terisi/% Terisi -- % Terisi dihitung
          dari Tanki Aktif (yang tidak rusak), bukan dari Total Tanki.
        </p>
        <DataTable
          rowKey={(r: TankOccupancyRow) => `${r.plant}-${r.tipeTanki}`}
          exportFileName="dashboard-produktivitas-tanki"
          storageKey="dashboard-produktivitas-tanki-v4"
          rows={tankOccupancy}
          emptyMessage="Belum ada data tanki."
          columns={[
            { key: "plant", label: "Plant", render: (r) => r.plant },
            { key: "tipeTanki", label: "Tipe Tanki", render: (r) => r.tipeTanki },
            { key: "total", label: "Total Tanki", render: (r) => r.total },
            { key: "aktif", label: "Tanki Aktif", render: (r) => r.aktif },
            {
              key: "damaged",
              label: "Damaged",
              render: (r) => <span style={{ color: r.damaged > 0 ? "var(--danger)" : undefined, fontWeight: r.damaged > 0 ? 700 : undefined }}>{r.damaged}</span>,
              csvValue: (r) => r.damaged,
            },
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
          footer={{
            plant: "Total",
            total: totalTanki,
            aktif: totalAktif,
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

        <div className="panel" style={{ padding: 16, marginBottom: 16, marginTop: 8 }}>
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
            {selectedStageSeries.label} -- Jumlah KG/Ltr Selesai
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
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Jumlah Formula (Order) Selesai All Proses</div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Jumlah Order/Batch yang Finish per tahap, per {GRANULARITY_OPTIONS.find((o) => o.value === granularity)?.label.toLowerCase()}.
          </p>
          <TrendLineChart points={trendPointsCount} series={STAGE_SERIES} yAxisLabel="Jumlah Order" granularity={granularity} showTable={showTrendTable} />
        </div>

        <div className="panel" style={{ padding: 16, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Jumlah KG/Ltr Selesai All Proses</div>
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

        {dashboardTab === "rftQc" && (
          <RftPanel
            title="RFT Quality Check"
            description={
              "Order OK (QC Passed) yang SEMUA hasil Check Results-nya Pass sejak percobaan pertama = Direct Passed; " +
              "pernah ada hasil Fail di percobaan sebelumnya = Not Direct Passed. Definisi & angkanya sama persis dengan " +
              "kartu RFT di Dashboard Quality. Dikelompokkan per tanggal QC Passed."
            }
            section={rftQuery.data?.qc}
            series={RFT_SERIES_QC}
            year={rftYear}
            showTable={showTrendTable}
            variant="qc"
          />
        )}

        {dashboardTab === "rftApproval" && (
          <RftPanel
            title="RFT Approval"
            description={
              "Order Oke Approval (Finish App terisi) yang TIDAK PERNAH ditandai Improve selama proses Approval = " +
              "lolos sekali jadi; yang pernah ditandai Improve (\"Trial N (NG)\" di Remark) = Pernah Improve. " +
              "Dikelompokkan per tanggal Finish App."
            }
            section={rftQuery.data?.approval}
            series={RFT_SERIES_APPROVAL}
            year={rftYear}
            showTable={showTrendTable}
            variant="approval"
          />
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
