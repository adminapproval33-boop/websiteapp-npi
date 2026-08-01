import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { evaluateSpec, SPEC_VERDICT_COLOR, SPEC_VERDICT_LABEL } from "../../lib/specEval";
import PremixAftermixPage from "../PremixAftermix/PremixAftermixPage";
import MillingPage from "../Milling/MillingPage";
import ColourMatchingPage from "../ColourMatching/ColourMatchingPage";
import CheckResultsPage from "../CheckResults/CheckResultsPage";
import ApprovalPage from "../Approval/ApprovalPage";
import PackingPage from "../Packing/PackingPage";
import MaterialFlowPanel from "./MaterialFlowPanel";

interface ProductionOrderRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  pctGR: string | null;
  orderType: string | null;
  process: string;
  start: string | null;
  finish: string | null;
  remark: string | null;
  codeTanki: string | null;
  leadTimeProses: number;
  stages: { name: string; done: boolean }[];
  progressPercent: number;
  /** Label Proses Packing, TERPISAH dari kolom "Proses" -- sesuai instruksi
   * eksplisit user (2026-07-28): kolom "Proses" cuma boleh diisi
   * Premix/Milling/Aftermix/Colour Matching/QC/Approval. */
  productionActions: string | null;
}

interface QcParamDetail {
  no: number;
  parameter: string;
  standard: string | null;
  result: string | null;
  start: string | null;
  finish: string | null;
}

interface QcCheckDetail {
  checkId: string;
  order: string;
  parameters: QcParamDetail[];
}

interface StageLeadTime {
  process: string;
  start: string | null;
  finish: string | null;
  leadTimeHariKerja: number | null;
}

interface ProcessRemark {
  process: string;
  remark: string | null;
  timestamp: string;
}

/** Detail Milling (input Fineness/Visco/Suhu per Pass) utk popup kolom
 * "Proses" saat statusnya salah satu tahap Milling -- dari GET
 * /milling/latest-by-order/:order (record Milling paling terakhir utk Order
 * ini, sama sumbernya dgn yg dipakai MillingPage sendiri). */
interface MillingDetail {
  codeMesin: string | null;
  spvProduksi: string;
  leader: string | null;
  start: string | null;
  finish: string | null;
  fineness: string[] | null;
  visco: string[] | null;
  suhu: string[] | null;
}

/**
 * Satu sumber warna dipakai BARENG oleh kolom "Proses" (badge) dan "Proses
 * Bar" (gradasi) supaya konsisten -- Queue & Done bukan tahap kerja (lihat
 * STAGE_SEQUENCE), tapi tetap py warna sendiri sbg titik awal/akhir gradasi.
 */
const STAGE_COLORS: Record<string, { bg: string; fg: string }> = {
  Queue: { bg: "#C0C0C0", fg: "#000000" },
  Premix: { bg: "#00FFFF", fg: "#000000" },
  Milling: { bg: "#008080", fg: "#ffffff" },
  Aftermix: { bg: "#0000FF", fg: "#ffffff" },
  "Colour Matching": { bg: "#000080", fg: "#ffffff" },
  QC: { bg: "#FFFF00", fg: "#000000" },
  Approval: { bg: "#808000", fg: "#ffffff" },
  Packing: { bg: "#00FF00", fg: "#000000" },
  Done: { bg: "#008000", fg: "#ffffff" },
  /** %GR=9999% (sentinel TECO SAP) utk Order yg pernah jalan -- badge merah,
   * beda dari "Done" (hijau tua), sesuai instruksi eksplisit user (2026-07-31). */
  Teco: { bg: "#FF0000", fg: "#ffffff" },
};

/** Urutan tahap kerja tetap (7 tahap, sama dgn yg dihitung backend utk Proses Bar). */
const STAGE_SEQUENCE = ["Premix", "Milling", "Aftermix", "Colour Matching", "QC", "Approval", "Packing"] as const;

/** Singkatan chip di kolom Proses Bar -- supaya baris gak melebar ke bawah. Nama
 * lengkapnya tetap muncul lewat tooltip (title) saat di-hover. */
const STAGE_ABBR: Record<string, string> = {
  Queue: "QU",
  Premix: "PM",
  Milling: "MI",
  Aftermix: "AF",
  "Colour Matching": "CM",
  QC: "QC",
  Approval: "AP",
  Packing: "PC",
  Done: "DN",
};

/** Label Proses tahap Approval (lihat finishBasedLabel di dashboard.routes.ts,
 * direvisi TOTAL 2026-07-29 -- cuma 3 state lagi, PERSIS mengikuti keberadaan
 * Order di "List Antrian Approval"/"Approval - Lot History"/Finish App). Set
 * ini SEMUA dikecualikan dari deteksi "isQc" (popup Item Check) di bawah
 * walau "QU - Approval" diawali "QU" bukan "QC", supaya aman kalau ada label
 * lain yg mirip di masa depan. */
const APPROVAL_STAGE_LABELS = new Set(["QU - Approval", "Approval", "Approval - DN"]);

/** Label Proses Packing di kolom "Production Actions" (lihat
 * latestPackingLabelByOrder di dashboard.routes.ts, direvisi 2026-07-29 --
 * "QU - Packing" (List Antrian Packing) dan "Packing" (History Packing,
 * Finish belum terisi) dipetakan ke warna Packing (hijau). "Done" (History
 * Packing, Finish SUDAH terisi) SENGAJA TIDAK masuk set ini -- itu dipetakan
 * ke warna "Done" (hijau tua) lewat exact-match key STAGE_COLORS.Done di
 * bawah, BEDA dari warna Packing, sesuai instruksi eksplisit user. "Packing"
 * polos sudah otomatis kena warna Packing lewat fallback ke STAGE_COLORS di
 * bawah juga, tapi tetap didaftarkan di sini spy jelas, sama pola dgn
 * PREMIX_STAGE_LABELS dkk. */
const PACKING_STAGE_LABELS = new Set(["QU - Packing", "Packing"]);

/** Label Proses granular Premix (lihat premixProcessLabel di
 * dashboard.routes.ts) -- SEMUA tahap (QU - Premix / Premix / Premix - DN)
 * sengaja dipetakan ke warna Premix yang sama (cyan), sesuai instruksi
 * eksplisit user (2026-07-26). Tahap Start ("Premix") sebenarnya sudah cocok
 * langsung lewat fallback ke STAGE_COLORS di bawah, tapi tetap dimasukkan ke
 * sini juga supaya jelas ketiganya satu warna. */
const PREMIX_STAGE_LABELS = new Set(["QU - Premix", "Premix", "Premix - DN"]);

/** Label Proses granular Milling (lihat millingProcessLabel di
 * dashboard.routes.ts) -- SEMUA tahap (QU - Milling / Milling / Milling - DN)
 * sengaja dipetakan ke warna Milling yang sama (teal), sesuai instruksi
 * eksplisit user (2026-07-26). Sama pola dgn PREMIX_STAGE_LABELS di atas. */
const MILLING_STAGE_LABELS = new Set(["QU - Milling", "Milling", "Milling - DN"]);

/** Label Proses granular Aftermix (lihat premixOrAftermixProcessLabel di
 * dashboard.routes.ts) -- SEMUA tahap (QU - Aftermix / Aftermix / Aftermix -
 * DN) sengaja dipetakan ke warna Aftermix yang sama (biru), sesuai instruksi
 * eksplisit user (2026-07-26, direvisi dari label statis "Aftermix" tanpa
 * tahapan). Sama pola dgn PREMIX_STAGE_LABELS di atas. */
const AFTERMIX_STAGE_LABELS = new Set(["QU - Aftermix", "Aftermix", "Aftermix - DN"]);

/** Label Proses di kolom "Proses" formatnya bervariasi (mis. "Oke Colour
 * Matching", "QC : Visco : Pass") -- dicocokkan ke salah satu warna di
 * STAGE_COLORS lewat prefix/substring, bukan exact match. */
function getProcessColor(process: string): { bg: string; fg: string } {
  if (APPROVAL_STAGE_LABELS.has(process)) return STAGE_COLORS.Approval;
  if (PACKING_STAGE_LABELS.has(process)) return STAGE_COLORS.Packing;
  if (PREMIX_STAGE_LABELS.has(process)) return STAGE_COLORS.Premix;
  if (MILLING_STAGE_LABELS.has(process)) return STAGE_COLORS.Milling;
  if (AFTERMIX_STAGE_LABELS.has(process)) return STAGE_COLORS.Aftermix;
  if (process.startsWith("QC")) return STAGE_COLORS.QC;
  if (process.includes("Colour Matching")) return STAGE_COLORS["Colour Matching"];
  return STAGE_COLORS[process] ?? { bg: "#e2e8f0", fg: "#1e293b" };
}

/** `onClick`/`tooltip` opsional -- kalau diisi (lihat pemanggil di kolom
 * "Proses" -- QC & Milling py popup detailnya sendiri2), badge jadi
 * clickable+underline; kalau tidak, tampil biasa (bukan link). Sebelumnya
 * "clickable" ditentukan HARDCODE di dalam komponen ini (cuma cek prefix
 * "QC"), dipindah ke pemanggil supaya tahap lain (mis. Milling) bisa py
 * popup detailnya sendiri juga, sesuai permintaan eksplisit user (2026-07-28). */
function ProcessBadge({ process, onClick, tooltip }: { process: string; onClick?: () => void; tooltip?: string }) {
  const colors = getProcessColor(process);
  const clickable = Boolean(onClick);
  return (
    <span
      onClick={onClick}
      title={tooltip}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: colors.bg,
        color: colors.fg,
        cursor: clickable ? "pointer" : "default",
        textDecoration: clickable ? "underline" : "none",
      }}
    >
      {process}
    </span>
  );
}

/**
 * Warna isian Proses Bar: gradasi BERURUTAN lewat warna tiap tahap yang
 * SUDAH dilewati (urutan tetap STAGE_SEQUENCE), mis. kalau baru Premix+Milling
 * -> "00FFFF, gradasi, lalu 008080". Kalau cuma 1 tahap terlewati, warnanya
 * solid (gak ada gradasi krn cuma 1 titik). Kalau full 7/7 (100%), warna
 * "Done" (008000) ditambahkan sbg titik akhir sbg penanda benar-benar selesai.
 */
function buildFillBackground(stages: { name: string; done: boolean }[], percent: number): string {
  const doneColors = STAGE_SEQUENCE.filter((name) => stages.find((s) => s.name === name)?.done).map(
    (name) => STAGE_COLORS[name].bg
  );
  if (percent >= 100) doneColors.push(STAGE_COLORS.Done.bg);
  if (doneColors.length === 0) return STAGE_COLORS.Queue.bg;
  if (doneColors.length === 1) return doneColors[0];
  return `linear-gradient(to right, ${doneColors.join(", ")})`;
}

/**
 * Kolom "Proses Bar": baris atas = progress bar gradasi (lihat
 * buildFillBackground) + persentase (dibuat lebih besar/lebar), baris bawah =
 * label singkatan (QU/PM/MI/dst). `stages` dari backend SUDAH dibatasi hanya
 * tahap yg relevan utk Material Number Order ini (lintas Order/Batch manapun
 * -- lihat computeStages di dashboard.routes.ts), jadi SEMUA entri di sini
 * ditampilkan labelnya -- yang "done" (pernah diinput Order ini sendiri)
 * berwarna, yang belum tetap tampil abu-abu (supaya tim MRP tahu keseluruhan
 * rangkaian proses Material ini, bukan cuma yg sudah dikerjakan Order ybs).
 * Line-height ke-2 baris ini SENGAJA dipepetkan (lineHeight 1, tanpa padding
 * vertikal di chip) supaya tinggi selnya tetap sama seperti sebelum dipecah
 * jadi 2 baris.
 */
function ProgressBarCell({ stages, percent }: { stages: { name: string; done: boolean }[]; percent: number }) {
  const allStages = [{ name: "Queue", done: true }, ...stages];

  return (
    <div style={{ minWidth: 260, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ position: "relative", width: 80, flexShrink: 0, height: 14, borderRadius: 999, background: STAGE_COLORS.Queue.bg, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${percent}%`,
              background: buildFillBackground(stages, percent),
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <span style={{ fontSize: "0.85rem", fontWeight: 800, minWidth: 36, flexShrink: 0 }}>{percent}%</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, lineHeight: 1 }}>
        {allStages.map((s) => (
          <StageChip key={s.name} label={s.name} done={s.done} colors={STAGE_COLORS[s.name] ?? { bg: "#e2e8f0", fg: "#1e293b" }} />
        ))}
      </div>
    </div>
  );
}

function StageChip({ label, done, colors }: { label: string; done: boolean; colors: { bg: string; fg: string } }) {
  return (
    <span
      title={label}
      style={{
        display: "inline-block",
        flexShrink: 0,
        padding: "1px 4px",
        borderRadius: 999,
        fontSize: "0.55rem",
        fontWeight: 700,
        lineHeight: 1,
        background: done ? colors.bg : "#e2e8f0",
        color: done ? colors.fg : "#94a3b8",
      }}
    >
      {STAGE_ABBR[label] ?? label}
    </span>
  );
}

/** Isi popup detail Milling: tabel Pass 1..N (Fineness/Visco/Suhu), full dari
 * Pass pertama sampai terakhir yg sudah diinput -- sesuai permintaan
 * eksplisit user (2026-07-28), sama pola tabel Pass di History Milling. */
function MillingDetailTable({ detail }: { detail: MillingDetail }) {
  const finenessArr = detail.fineness ?? [];
  const viscoArr = detail.visco ?? [];
  const suhuArr = detail.suhu ?? [];
  const passCount = Math.max(finenessArr.length, viscoArr.length, suhuArr.length);
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Pass</th>
              <th>Fineness</th>
              <th>Visco</th>
              <th>Suhu</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: passCount }).map((_, idx) => (
              <tr key={idx}>
                <td>Pass {idx + 1}</td>
                <td>{finenessArr[idx] || "-"}</td>
                <td>{viscoArr[idx] || "-"}</td>
                <td>{suhuArr[idx] || "-"}</td>
              </tr>
            ))}
            {passCount === 0 && (
              <tr>
                <td colSpan={4}>Belum ada bacaan Fineness/Visco/Suhu.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 14, fontSize: "0.78rem", color: "var(--text-muted)" }}>
        Code Mesin: {detail.codeMesin || "-"} · SPV Produksi: {detail.spvProduksi || "-"} · Leader: {detail.leader || "-"}
        <br />
        Start: {formatDateTime(detail.start)} · Finish: {detail.finish ? formatDateTime(detail.finish) : "Belum selesai"}
      </p>
    </>
  );
}

export default function ProductionOrderDashboardPage() {
  const [search, setSearch] = useState("");
  const [qcDetailOrder, setQcDetailOrder] = useState<string | null>(null);
  const [leadTimeDetailOrder, setLeadTimeDetailOrder] = useState<string | null>(null);
  const [remarkDetailOrder, setRemarkDetailOrder] = useState<string | null>(null);
  const [millingDetailOrder, setMillingDetailOrder] = useState<string | null>(null);
  // Pop-up "Tahap Selanjutnya" (2026-07-31, instruksi eksplisit user): klik
  // tombol di kolom Proses Bar -> buka Modal INFO ("Info Proses Material" +
  // tombol "Buka Input" per tahap) DAN Modal FORM (form Input tahap PERTAMA
  // yg belum "done") SEKALIGUS, sbg 2 pop-up terpisah (bukan numpuk 1 modal
  // panjang) -- direvisi 2026-07-31 (instruksi eksplisit user): form Input
  // HARUS pop-up sendiri, bukan ditempel di bawah panel info. Modal FORM
  // rendernya di ATAS Modal INFO (backdrop-nya nutupin), jadi begitu Modal
  // FORM ditutup, Modal INFO kelihatan lagi -- dari situ bisa lompat ke
  // tahap lain lewat tombol per-baris (buka Modal FORM baru lagi).
  const [infoTarget, setInfoTarget] = useState<{
    order: string;
    materialNumber: string | null;
    stages: { name: string; done: boolean }[];
  } | null>(null);
  const [inputTarget, setInputTarget] = useState<{ order: string; stage: string } | null>(null);

  const rowsQuery = useQuery({
    queryKey: ["dashboard-production-orders", search],
    queryFn: () =>
      api
        .get<{ success: boolean; data: ProductionOrderRow[] }>(`/dashboard/production-orders?search=${encodeURIComponent(search)}`)
        .then((r) => r.data),
  });

  const qcDetailQuery = useQuery({
    queryKey: ["dashboard-qc-detail", qcDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: QcCheckDetail | null }>(`/check-results/by-order/${encodeURIComponent(qcDetailOrder!)}`)
        .then((r) => r.data),
    enabled: qcDetailOrder != null,
  });

  const leadTimeDetailQuery = useQuery({
    queryKey: ["dashboard-lead-time-detail", leadTimeDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: StageLeadTime[] }>(
          `/dashboard/production-orders/${encodeURIComponent(leadTimeDetailOrder!)}/stage-lead-times`
        )
        .then((r) => r.data),
    enabled: leadTimeDetailOrder != null,
  });

  const remarkDetailQuery = useQuery({
    queryKey: ["dashboard-remark-detail", remarkDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: ProcessRemark[] }>(
          `/dashboard/production-orders/${encodeURIComponent(remarkDetailOrder!)}/remarks`
        )
        .then((r) => r.data),
    enabled: remarkDetailOrder != null,
  });

  const millingDetailQuery = useQuery({
    queryKey: ["dashboard-milling-detail", millingDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MillingDetail | null }>(`/milling/latest-by-order/${encodeURIComponent(millingDetailOrder!)}`)
        .then((r) => r.data),
    enabled: millingDetailOrder != null,
  });

  return (
    <div className="panel">
      <div className="panel-header">Production Order Monitoring ({rowsQuery.data?.length ?? 0} ditampilkan)</div>
      <div className="panel-body">
        <p style={{ marginTop: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Status Order terkini yang sudah diinput di Premix, Aftermix, Milling, Colour Matching, dan Packing --
          acuannya nomor Order. Setiap Order hanya ditampilkan 1 baris, yaitu hasil inputan PALING TERAKHIR
          (proses apa pun) -- bukan seluruh riwayatnya. Material Number, Material Description, dan Batch selalu
          diambil langsung dari Master Data Cooispi terbaru (bukan snapshot lama), jadi otomatis ikut ter-update
          kalau data di sana diubah. <strong>Lead Time Proses</strong> = jumlah hari kerja (Sabtu/Minggu tidak
          dihitung) sejak Order ini pertama kali muncul di sistem (modul manapun) sampai hari ini.{" "}
          <strong>Proses Bar</strong> = progres Order ini dari rangkaian tahap Material Number-nya (Premix, Milling,
          Aftermix, Colour Matching, QC, Approval, Packing -- hanya tahap yang PERNAH ada histori Material Number ini
          di Order manapun yang dicantumkan labelnya, karena tiap Material Number bisa punya rangkaian proses yang
          berbeda-beda), warnanya sama persis dengan warna badge di kolom Proses. Label singkatan (QU/PM/MI/dst) yang
          berwarna berarti tahap itu sudah diinput utk Order ini sendiri; yang abu-abu berarti tahap itu ada di
          riwayat Material Number ini (dari Order lain) tapi belum diinput utk Order ini. Arahkan kursor ke label
          utk lihat nama lengkapnya.
        </p>
        <input
          placeholder="Cari nomor Order..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
        />
        <DataTable
          rowKey={(r: ProductionOrderRow) => `${r.order}-${r.process}-${r.start}`}
          exportFileName="dashboard-production-orders"
          storageKey="dashboard-production-orders"
          rows={rowsQuery.data ?? []}
          columns={[
            { key: "order", label: "Order", render: (r) => r.order },
            { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
            { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
            { key: "batch", label: "Batch", render: (r) => r.batch },
            { key: "orderType", label: "Order Type", render: (r) => r.orderType ?? "-" },
            { key: "orderQty", label: "Qty/Liter", render: (r) => r.orderQty },
            { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki ?? "-" },
            { key: "pctGR", label: "% GR", render: (r) => r.pctGR ?? "-" },
            {
              key: "progressBar",
              label: "Proses Bar",
              // +30px drpd lebar asli (260) supaya tombol muat di sisi kiri
              // TANPA bikin bar progress-nya sendiri kepotong/ke-hidden oleh
              // batas lebar kolom (ProgressBarCell py minWidth 260 sendiri).
              defaultWidth: 290,
              render: (r) => {
                // Order yg SEMUA tahapnya sudah done -> tombol tetap aktif,
                // arahkan ke tahap TERAKHIR (biasanya Packing) supaya tetap
                // bisa dibuka/direview -- form-nya otomatis masuk mode Edit
                // krn datanya sudah ada (lihat handleOrderFound tiap
                // halaman). Cuma beneran nonaktif kalau Order ini tidak py
                // tahap relevan sama sekali (kasus langka, MaterialFlow-nya
                // kosong semua).
                const target = r.stages.find((s) => !s.done) ?? r.stages[r.stages.length - 1];
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      disabled={!target}
                      title={target ? `Buka Input ${target.name}` : "Order ini belum punya tahap yg relevan"}
                      onClick={() => {
                        if (!target) return;
                        // Direvisi 2026-07-31 (instruksi eksplisit user): cuma buka
                        // pop-up Info dulu -- pop-up Input form BARU muncul kalau
                        // admin klik "Buka Input" dari dalam pop-up Info (lihat
                        // MaterialFlowPanel/onOpenStage), bukan otomatis sekaligus.
                        setInfoTarget({ order: r.order, materialNumber: r.materialNumber, stages: r.stages });
                      }}
                      style={{
                        flexShrink: 0,
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: `1px solid ${target ? "var(--navy-light)" : "var(--border)"}`,
                        background: "#fff",
                        color: target ? "var(--navy)" : "var(--text-muted)",
                        cursor: target ? "pointer" : "not-allowed",
                        opacity: target ? 1 : 0.5,
                        fontSize: "0.8rem",
                        lineHeight: 1,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      ➜
                    </button>
                    <ProgressBarCell stages={r.stages} percent={r.progressPercent} />
                  </div>
                );
              },
              csvValue: (r) => `${r.progressPercent}% (${r.stages.filter((s) => s.done).map((s) => s.name).join(", ")})`,
            },
            {
              key: "process",
              label: "Proses",
              render: (r) => {
                if (MILLING_STAGE_LABELS.has(r.process)) {
                  return (
                    <ProcessBadge
                      process={r.process}
                      onClick={() => setMillingDetailOrder(r.order)}
                      tooltip="Klik utk lihat detail Pass Fineness/Visco/Suhu"
                    />
                  );
                }
                const isQc = r.process.startsWith("QC") && !APPROVAL_STAGE_LABELS.has(r.process);
                if (isQc) {
                  return (
                    <ProcessBadge
                      process={r.process}
                      onClick={() => setQcDetailOrder(r.order)}
                      tooltip="Klik utk lihat detail Item Check, Start, Finish, Verdict"
                    />
                  );
                }
                return <ProcessBadge process={r.process} />;
              },
              csvValue: (r) => r.process,
            },
            {
              key: "productionActions",
              label: "Production Actions",
              render: (r) => (r.productionActions ? <ProcessBadge process={r.productionActions} /> : "-"),
              csvValue: (r) => r.productionActions ?? "-",
            },
            {
              key: "start",
              label: "Start",
              render: (r) => (
                <span
                  onClick={() => setLeadTimeDetailOrder(r.order)}
                  title="Klik utk lihat rangkuman Start & Finish di semua tahap"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  {formatDateTime(r.start)}
                </span>
              ),
              csvValue: (r) => toExcelDateTimeString(r.start),
            },
            {
              key: "finish",
              label: "Finish",
              render: (r) => (
                <span
                  onClick={() => setLeadTimeDetailOrder(r.order)}
                  title="Klik utk lihat rangkuman Start & Finish di semua tahap"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  {formatDateTime(r.finish)}
                </span>
              ),
              csvValue: (r) => toExcelDateTimeString(r.finish),
            },
            {
              key: "remark",
              label: "Remark",
              render: (r) => (
                <span
                  onClick={() => setRemarkDetailOrder(r.order)}
                  title="Klik utk lihat Remark tiap proses (Premix/Aftermix/Milling/dst tidak lagi saling mewarisi)"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  {r.remark || "-"}
                </span>
              ),
              csvValue: (r) => r.remark,
            },
            {
              key: "leadTimeProses",
              label: "Lead Time Proses",
              render: (r) => (
                <span
                  onClick={() => setLeadTimeDetailOrder(r.order)}
                  title="Klik utk lihat lama proses di tiap tahapan"
                  style={{ cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                >
                  {r.leadTimeProses} hari kerja
                </span>
              ),
              csvValue: (r) => r.leadTimeProses,
            },
          ]}
        />
      </div>

      {qcDetailOrder && (
        <Modal title={`Detail QC — Order ${qcDetailOrder}`} onClose={() => setQcDetailOrder(null)} width={720}>
          {qcDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!qcDetailQuery.isLoading && !qcDetailQuery.data && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada data Check Results untuk Order ini.</p>
          )}
          {qcDetailQuery.data && (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item Check</th>
                    <th>Spec</th>
                    <th>Result</th>
                    <th>Start</th>
                    <th>Finish</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {qcDetailQuery.data.parameters.map((p) => {
                    const verdict = evaluateSpec(p.standard, p.result);
                    return (
                      <tr key={p.no}>
                        <td>{p.parameter}</td>
                        <td>{p.standard || "-"}</td>
                        <td>{p.result || "-"}</td>
                        <td>{formatDateTime(p.start)}</td>
                        <td>{formatDateTime(p.finish)}</td>
                        <td style={{ background: SPEC_VERDICT_COLOR[verdict] }}>{SPEC_VERDICT_LABEL[verdict]}</td>
                      </tr>
                    );
                  })}
                  {qcDetailQuery.data.parameters.length === 0 && (
                    <tr>
                      <td colSpan={6}>Belum ada Item Check.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {leadTimeDetailOrder && (
        <Modal title={`Start & Finish per Tahap — Order ${leadTimeDetailOrder}`} onClose={() => setLeadTimeDetailOrder(null)} width={640}>
          {leadTimeDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!leadTimeDetailQuery.isLoading && (leadTimeDetailQuery.data?.length ?? 0) === 0 && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada tahapan proses yang punya data Start untuk Order ini.</p>
          )}
          {leadTimeDetailQuery.data && leadTimeDetailQuery.data.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proses</th>
                    <th>Start</th>
                    <th>Finish</th>
                    <th>Lead Time</th>
                  </tr>
                </thead>
                <tbody>
                  {leadTimeDetailQuery.data.map((s) => (
                    <tr key={s.process}>
                      <td>{s.process}</td>
                      <td>{formatDateTime(s.start)}</td>
                      <td>{s.finish ? formatDateTime(s.finish) : "Belum selesai"}</td>
                      <td>{s.leadTimeHariKerja} hari kerja</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Lead Time tiap tahapan dihitung hari kerja (Sabtu/Minggu tidak dihitung), sama seperti Lead Time Proses
            total. Tahapan yang "Belum selesai" dihitung sampai hari ini.
          </p>
        </Modal>
      )}

      {remarkDetailOrder && (
        <Modal title={`Remark per Proses — Order ${remarkDetailOrder}`} onClose={() => setRemarkDetailOrder(null)} width={640}>
          {remarkDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!remarkDetailQuery.isLoading && (remarkDetailQuery.data?.length ?? 0) === 0 && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada Remark yang diinput di proses manapun untuk Order ini.</p>
          )}
          {remarkDetailQuery.data && remarkDetailQuery.data.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proses</th>
                    <th>Remark</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {remarkDetailQuery.data.map((r) => (
                    <tr key={r.process}>
                      <td>{r.process}</td>
                      <td>{r.remark || "-"}</td>
                      <td>{formatDateTime(r.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Sejak Remark tiap proses dipisah (tidak lagi saling mewarisi antar modul), tiap tahap punya Remark
            sendiri-sendiri -- popup ini menampilkan Remark dari SEMUA tahap yang pernah diinput utk Order ini
            sekaligus, bukan cuma Remark dari input paling terakhir (yang tampil di kolom Remark tabel).
          </p>
        </Modal>
      )}

      {millingDetailOrder && (
        <Modal title={`Detail Pass Milling — Order ${millingDetailOrder}`} onClose={() => setMillingDetailOrder(null)} width={520}>
          {millingDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!millingDetailQuery.isLoading && !millingDetailQuery.data && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada data Milling untuk Order ini.</p>
          )}
          {millingDetailQuery.data && <MillingDetailTable detail={millingDetailQuery.data} />}
        </Modal>
      )}

      {infoTarget && (
        <Modal title={`Info Proses — Order ${infoTarget.order}`} onClose={() => setInfoTarget(null)} width={860}>
          <MaterialFlowPanel
            materialNumber={infoTarget.materialNumber}
            stages={infoTarget.stages}
            onFlowSaved={() => rowsQuery.refetch()}
            onOpenStage={(stage) => setInputTarget({ order: infoTarget.order, stage })}
          />
        </Modal>
      )}

      {inputTarget && (
        <Modal title={`Input ${inputTarget.stage} — Order ${inputTarget.order}`} onClose={() => setInputTarget(null)} width={980}>
          {(() => {
            const closeAndRefresh = () => {
              setInputTarget(null);
              setInfoTarget(null);
              rowsQuery.refetch();
            };
            switch (inputTarget.stage) {
              case "Premix":
                return (
                  <PremixAftermixPage
                    section="PREMIX"
                    title="Premix"
                    embedded
                    initialOrder={inputTarget.order}
                    onSaved={closeAndRefresh}
                  />
                );
              case "Milling":
                return <MillingPage embedded initialOrder={inputTarget.order} onSaved={closeAndRefresh} />;
              case "Aftermix":
                return (
                  <PremixAftermixPage
                    section="AFTERMIX"
                    title="Aftermix"
                    embedded
                    initialOrder={inputTarget.order}
                    onSaved={closeAndRefresh}
                  />
                );
              case "Colour Matching":
                return <ColourMatchingPage embedded initialOrder={inputTarget.order} onSaved={closeAndRefresh} />;
              case "QC":
                return <CheckResultsPage embedded initialOrder={inputTarget.order} onSaved={closeAndRefresh} />;
              case "Approval":
                return <ApprovalPage embedded initialOrder={inputTarget.order} onSaved={closeAndRefresh} />;
              case "Packing":
                return <PackingPage embedded initialOrder={inputTarget.order} onSaved={closeAndRefresh} />;
              default:
                return <p style={{ color: "var(--text-muted)" }}>Tahap tidak dikenali.</p>;
            }
          })()}
        </Modal>
      )}
    </div>
  );
}
