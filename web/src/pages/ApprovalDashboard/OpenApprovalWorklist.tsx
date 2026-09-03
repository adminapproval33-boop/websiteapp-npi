import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable, { DataTableColumn } from "../../components/DataTable";
import { formatInputBy, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";
import type { LotHistoryRow } from "../Approval/ApprovalPage";

type StatusVerdict = "Prepare Approval" | "Wait Approval" | "Approval" | "Oke Approval";

interface WorklistItem {
  approvalId: string;
  order: string;
  batch: string;
  plant: string;
  customer: string;
  sku: string;
  segment: string;
  qty: number;
  tech: string;
  sales: string;
  days: number;
  bucket: Bucket;
  ready: boolean;
  status: StatusVerdict;
  needsImprove: boolean;
  /** Tanggal "Prepare Date" (yyyy-mm-dd) -- dasar filter range waktu (2026-09-03,
   * instruksi eksplisit user). Fallback ke `timestamp` kalau Prepare Date kosong,
   * SAMA PERSIS dgn `start` yg dipakai hitung `days`/bucket, supaya konsisten. */
  prepareDate: string;
}

// Filter kartu KPI utama (2026-09-03, instruksi eksplisit user) -- "Improve"
// BUKAN bagian dari StatusVerdict (itu boolean `needsImprove` terpisah, lihat
// computeStatus di server), jadi diberi nilai penanda sendiri di sini.
type StatusCardFilter = StatusVerdict | "Improve";

// Bucket "Lama Proses" -- SAMA PERSIS dgn AGE_BUCKETS di Quality Check Review
// (2026-09-03, instruksi eksplisit user): label "15-21 Hari" & "21-30 Hari"
// sekilas tumpang tindih di angka 21, tapi `bucketOf` pakai `maxDays` dan
// ambil match PERTAMA, jadi day 21 tetap masuk "15-21" saja, tanpa duplikasi.
const AGE_BUCKETS = [
  { key: "1-7", label: "1-7 Hari", maxDays: 7, color: "#2ECC71" },
  { key: "8-14", label: "8-14 Hari", maxDays: 14, color: "#F1C40F" },
  { key: "15-21", label: "15-21 Hari", maxDays: 21, color: "#E67E22" },
  { key: "21-30", label: "21-30 Hari", maxDays: 30, color: "#E74C3C" },
  { key: ">30", label: ">30 Hari", maxDays: Infinity, color: "#962D22" },
] as const;
type Bucket = (typeof AGE_BUCKETS)[number]["key"];

function bucketOf(days: number): Bucket {
  return (AGE_BUCKETS.find((b) => days <= b.maxDays) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).key;
}

const UNASSIGNED = "UNASSIGNED";

// "-" dipakai di data sbg placeholder "belum diisi" (2026-09-04, instruksi
// eksplisit user) -- SEBELUMNYA cuma null/string kosong yg dianggap kosong,
// jadi "Cust Segmen: -" dkk kepisah jadi grup sendiri "-", bukan ikut masuk
// ke kartu "No Cust Segmen"/dst. Dipakai di `items` (bukan sesudahnya) supaya
// SEMUA turunan (kartu PIC, filter, tabel) otomatis konsisten.
function isBlankValue(v: string | null | undefined): boolean {
  const t = v?.trim() ?? "";
  return t === "" || t === "-";
}

// Kartu "tidak punya PIC/Customer/Cust Segmen" (2026-09-04, instruksi
// eksplisit user) -- tech/sales pakai fallback "UNASSIGNED" (lihat `items`),
// customer/segment pakai fallback "UNKNOWN" (lihat `groups`). SEBELUMNYA
// hanya "UNASSIGNED" yg dianggap alert (di-highlight merah & taruh
// urutan pertama), jadi "UNKNOWN" di view Customer/Cust Segmen kelewat.
function isUnassignedGroup(name: string): boolean {
  return name === UNASSIGNED || name === "UNKNOWN";
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

type ViewMode = "tech" | "sales" | "customer" | "segment";
// "noown" DIGANTI jadi "notech" (2026-09-01, instruksi eksplisit user) --
// filter Sales PIC kosong TIDAK terpakai (di data real sekarang ini SELALU
// 0, lihat komentar di kartu "No Tech PIC"/"No Sales PIC" di atas), Tech PIC
// kosong yg justru sering kejadian (144 item) makanya filter ini diarahkan
// ke situ.
type ReadyFilter = "ALL" | "ready" | "wip" | "notech";
type OwnerFilter = { role: "tech" | "sales"; name: string } | null;

const VIEW_LABEL: Record<ViewMode, string> = { tech: "Tech PIC", sales: "Sales PIC", customer: "Customer", segment: "Cust Segmen" };

/** Kolom tabel "Item explorer" (2026-09-04, instruksi eksplisit user: isi &
 * formatnya disamakan dgn tabel "Approval — Lot History" di
 * /planning/approval) -- HARUS SELALU disamakan dgn array `columns` di dalam
 * `tab === "history"` punya ApprovalPage.tsx (kolom data, urutan, & render
 * masing2 kolom harus identik), KECUALI kolom Aksi: di sini SENGAJA tidak
 * membuka form Edit lokal (form itu besar & rawan divergen dari
 * ApprovalPage.tsx) -- Edit/Lampiran cuma `navigate()` ke
 * /planning/approval bawa approvalId/order lewat query string (lihat
 * `useEffect` deep-link di ApprovalPage.tsx), Hapus tetap panggil endpoint
 * DELETE /approvals/:id langsung krn tidak ada logika bisnis yg perlu
 * disinkronkan. */
function buildItemExplorerColumns(opts: {
  navigate: (path: string) => void;
  canDelete: boolean;
  onDelete: (row: LotHistoryRow) => void;
  employees: ReturnType<typeof useEmployeeOptions>["data"];
}): DataTableColumn<LotHistoryRow>[] {
  const { navigate, canDelete, onDelete, employees } = opts;
  return [
    { key: "order", label: "Order", render: (r) => r.order },
    {
      key: "timestamp",
      label: "Timestamp",
      render: (r) => formatDateTime(r.timestamp),
      csvValue: (r) => toExcelDateTimeString(r.timestamp),
    },
    { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
    { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
    { key: "batch", label: "Batch", render: (r) => r.batch },
    { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
    { key: "plant", label: "Plant", render: (r) => r.plant },
    { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
    { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
    { key: "mrpPic", label: "Mrp Pic", render: (r) => r.mrpPic },
    { key: "salesPic", label: "Sales Pic", render: (r) => r.salesPic },
    {
      key: "prepareProduksi",
      label: "Prepare Date",
      render: (r) => formatDateTime(r.prepareProduksi),
      csvValue: (r) => toExcelDateTimeString(r.prepareProduksi),
    },
    { key: "sprayMan", label: "Spray Man", render: (r) => r.sprayMan },
    { key: "wetSample", label: "Wet Sample", render: (r) => r.wetSample },
    { key: "panel", label: "Panel", render: (r) => r.panel },
    {
      key: "lotCoa",
      label: "Lot COA",
      render: (r) => formatDateTime(r.lotCoa),
      csvValue: (r) => toExcelDateTimeString(r.lotCoa),
    },
    {
      key: "sendToTech",
      label: "Send To Tech",
      render: (r) => formatDateTime(r.sendToTech),
      csvValue: (r) => toExcelDateTimeString(r.sendToTech),
    },
    {
      key: "technicalDateReceiving",
      label: "Submit Tech",
      render: (r) => formatDateTime(r.technicalDateReceiving),
      csvValue: (r) => toExcelDateTimeString(r.technicalDateReceiving),
    },
    {
      key: "submitToCustomer",
      label: "Submit Cust",
      render: (r) => formatDateTime(r.submitToCustomer),
      csvValue: (r) => toExcelDateTimeString(r.submitToCustomer),
    },
    { key: "customer", label: "Customer", render: (r) => r.customer },
    { key: "custSegmen", label: "Cust Segmen", render: (r) => r.custSegmen },
    { key: "multipleCust", label: "Multiple Cust", render: (r) => r.multipleCust },
    { key: "techName", label: "Tech Name", render: (r) => r.techName },
    {
      key: "finishApp",
      label: "Finish App",
      render: (r) => formatDateTime(r.finishApp),
      csvValue: (r) => toExcelDateTimeString(r.finishApp),
    },
    { key: "remark", label: "Remark", render: (r) => r.remark },
    { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
    { key: "status", label: "Status", render: (r) => r.status },
    {
      key: "needsImprove",
      label: "Improve",
      render: (r) => (
        <span className={r.needsImprove ? "btn btn-danger" : "btn btn-success"} style={{ padding: "3px 12px", fontSize: "0.8rem" }}>
          {r.needsImprove ? "🔴 Improve" : "🟢 Normal"}
        </span>
      ),
      csvValue: (r) => (r.needsImprove ? "Improve" : "Normal"),
    },
    { key: "processingTime", label: "Processing Time", render: (r) => r.processingTime },
    { key: "hasAttachment", label: "Lampiran", render: (r) => (r.hasAttachment ? "Filled" : "No File"), csvValue: (r) => (r.hasAttachment ? "Filled" : "No File") },
    { key: "pctGR", label: "% GR", render: (r) => r.pctGR ?? "-" },
    {
      key: "actions",
      label: "Aksi",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            className="btn btn-outline"
            type="button"
            title="Edit"
            aria-label="Edit"
            style={{ padding: "6px 10px" }}
            onClick={() => navigate(`/planning/approval?editApprovalId=${encodeURIComponent(r.approvalId)}&editOrder=${encodeURIComponent(r.order)}`)}
          >
            ✏️
          </button>
          <button
            className="btn btn-outline"
            type="button"
            title="Lampiran"
            aria-label="Lampiran"
            style={{ padding: "6px 10px" }}
            onClick={() => navigate(`/planning/approval?attachmentApprovalId=${encodeURIComponent(r.approvalId)}`)}
          >
            📎
          </button>
          {canDelete && (
            <button className="btn btn-danger" type="button" title="Hapus" aria-label="Hapus" style={{ padding: "6px 10px" }} onClick={() => onDelete(r)}>
              🗑️
            </button>
          )}
        </div>
      ),
      csvValue: () => "",
    },
  ];
}

export default function OpenApprovalWorklist() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  // Sumber data DIGANTI dari GET /approvals ke GET /approvals/lot-history
  // TANPA filter (2026-09-04, instruksi eksplisit user: tabel "Item explorer"
  // isi & formatnya disamakan dgn "Approval — Lot History") -- endpoint ini
  // sudah menghitung `status` (computeStatus) & field turunan lain
  // (processingTime/hasAttachment/pctGR) yg SAMA PERSIS dipakai tab History
  // di ApprovalPage.tsx, jadi tabel di Dashboard ini otomatis konsisten byte-
  // for-byte tanpa perlu hitung ulang di sini.
  const { data, isLoading } = useQuery({
    queryKey: ["approval-lot-history-dashboard"],
    queryFn: () => api.get<{ success: boolean; data: LotHistoryRow[] }>("/approvals/lot-history").then((r) => r.data),
  });

  const rawByApprovalId = useMemo(() => new Map((data ?? []).map((r) => [r.approvalId, r])), [data]);

  const items: WorklistItem[] = useMemo(() => {
    const now = Date.now();
    return (data ?? []).map((r) => {
      const start = r.prepareProduksi ? new Date(r.prepareProduksi) : new Date(r.timestamp);
      const days = Math.max(0, Math.floor((now - start.getTime()) / 86400000));
      const qty = Number(String(r.orderQty ?? "").replace(/,/g, "")) || 0;
      return {
        approvalId: r.approvalId,
        order: r.order,
        batch: r.batch?.trim() || "-",
        plant: r.plant?.trim() || "-",
        customer: isBlankValue(r.customer) ? "UNKNOWN" : r.customer!.trim(),
        sku: r.materialDescription?.trim() || r.materialNumber?.trim() || "-",
        segment: isBlankValue(r.custSegmen) ? "" : r.custSegmen!.trim(),
        qty,
        tech: isBlankValue(r.techName) ? UNASSIGNED : r.techName!.trim(),
        sales: isBlankValue(r.salesPic) ? UNASSIGNED : r.salesPic!.trim(),
        days,
        bucket: bucketOf(days),
        ready: !!r.submitToCustomer,
        status: r.status,
        needsImprove: r.needsImprove,
        prepareDate: start.toISOString().slice(0, 10),
      };
    });
  }, [data]);

  const [plant, setPlant] = useState<string>("ALL");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusCardFilter | null>(null);
  const [view, setView] = useState<ViewMode>("tech");
  const [search, setSearch] = useState("");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("ALL");
  const [owner, setOwner] = useState<OwnerFilter>(null);
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [segmentFilter, setSegmentFilter] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  // Dropdown "☰ Kelompokkan" (2026-09-03, instruksi eksplisit user, gaya
  // disamakan dgn "☰ Status" di Quality Check Review) -- GANTI tampilan dari
  // 4 tombol tab jadi 1 tombol dropdown, TAPI perilakunya tetap satu pilihan
  // (radio), bukan checkbox multi-pilih, krn `view` cuma bisa 1 dimensi
  // pengelompokan pada satu waktu.
  const [showViewPanel, setShowViewPanel] = useState(false);
  // Dropdown "☰ Plant" (2026-09-04, instruksi eksplisit user) -- gabungan 3
  // tombol Plant terpisah jadi 1 tombol dropdown, gaya & pola SAMA PERSIS dgn
  // "☰ Kelompokkan" di sebelahnya (radio single-select).
  const [showPlantPanel, setShowPlantPanel] = useState(false);
  // Range waktu "Dari - Sampai" (2026-09-03, instruksi eksplisit user) --
  // filter berdasar "Prepare Date" (fallback timestamp kalau kosong, sama
  // dgn dasar hitung Lama Proses). String kosong = tanpa batas.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const plants = useMemo(() => Array.from(new Set(items.map((i) => i.plant))).sort(), [items]);

  const base = useMemo(
    () =>
      items.filter(
        (i) =>
          (plant === "ALL" || i.plant === plant) &&
          (!dateFrom || i.prepareDate >= dateFrom) &&
          (!dateTo || i.prepareDate <= dateTo)
      ),
    [items, plant, dateFrom, dateTo]
  );

  function resetPlantScopedFilters() {
    setBucket(null);
    setStatusFilter(null);
    setOwner(null);
    setCustomerFilter(null);
    setSegmentFilter(null);
  }

  function clearFilters() {
    setBucket(null);
    setStatusFilter(null);
    setSearch("");
    setReadyFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setOwner(null);
    setCustomerFilter(null);
    setSegmentFilter(null);
  }

  // Gabungan filter "bucket" (Lama Proses) + "statusFilter" (kartu KPI Status
  // atas) -- dipakai SEMUA kartu KPI, grup PIC, & tabel di bawah, supaya klik
  // kartu manapun langsung kelihatan efeknya di kartu2 lain (2026-09-04,
  // laporan user: klik kartu status "Approval" tidak mempengaruhi kartu
  // "Lama Proses" -- sebelumnya kartu KPI status atas & Lama Proses masing2
  // cuma dihitung dari `base` polos, tidak saling menyerap filter lawannya).
  const crossFiltered = useMemo(() => {
    let rows = bucket ? base.filter((i) => i.bucket === bucket) : base;
    if (statusFilter === "Improve") rows = rows.filter((i) => i.needsImprove);
    else if (statusFilter) rows = rows.filter((i) => i.status === statusFilter);
    return rows;
  }, [base, bucket, statusFilter]);

  const explorerRows = useMemo(() => {
    let rows = crossFiltered;
    if (readyFilter === "ready") rows = rows.filter((i) => i.ready);
    if (readyFilter === "wip") rows = rows.filter((i) => !i.ready);
    if (readyFilter === "notech") rows = rows.filter((i) => i.tech === UNASSIGNED);
    if (owner) rows = rows.filter((i) => i[owner.role] === owner.name);
    if (customerFilter) rows = rows.filter((i) => i.customer === customerFilter);
    if (segmentFilter) rows = rows.filter((i) => (i.segment || "UNKNOWN") === segmentFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((i) => `${i.customer} ${i.sku} ${i.order} ${i.batch} ${i.tech} ${i.sales}`.toLowerCase().includes(q));
    }
    // Urutan default overdue dulu (2026-09-04) -- sort per-kolom yg bisa
    // diklik user sekarang ditangani `DataTable` sendiri (lihat tabel di
    // bawah), jadi di sini cukup 1 urutan default tetap, bukan lagi state
    // `sort` yg bisa diubah manual spt tabel custom sebelumnya.
    return [...rows].sort((a, b) => b.days - a.days);
  }, [crossFiltered, readyFilter, owner, customerFilter, segmentFilter, search]);

  // Baris MENTAH (LotHistoryRow, semua field Lot History) versi terfilter,
  // dipakai tabel "Item explorer" di bawah -- `explorerRows` (WorklistItem)
  // di atas TETAP dipertahankan krn dipakai search/filter/kartu PIC, baris
  // mentahnya di-lookup lewat `rawByApprovalId` supaya tidak perlu hitung
  // ulang filter yg sama dua kali.
  const explorerRawRows = useMemo(
    () => explorerRows.map((i) => rawByApprovalId.get(i.approvalId)).filter((r): r is LotHistoryRow => !!r),
    [explorerRows, rawByApprovalId]
  );

  const canDeleteApproval = getMenuLevel(user, "approval") === "INPUT";

  const deleteMutation = useMutation({
    mutationFn: (approvalId: string) => api.delete(`/approvals/${approvalId}`),
    onSuccess: () => {
      setDeleteError("");
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history-dashboard"] });
    },
    onError: (err) => setDeleteError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const itemExplorerColumns = useMemo(
    () =>
      buildItemExplorerColumns({
        navigate,
        canDelete: canDeleteApproval,
        employees,
        onDelete: (row) => {
          if (confirm(`Hapus data Approval untuk Order ${row.order}?`)) deleteMutation.mutate(row.approvalId);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canDeleteApproval, employees]
  );

  const groups = useMemo(() => {
    const scoped = crossFiltered;
    const key = view;
    const map = new Map<string, WorklistItem[]>();
    for (const item of scoped) {
      const name = item[key] || "UNKNOWN";
      const arr = map.get(name) ?? [];
      arr.push(item);
      map.set(name, arr);
    }
    const arr = Array.from(map.entries()).map(([name, its]) => ({
      name,
      items: [...its].sort((a, b) => b.days - a.days),
      n: its.length,
      qty: its.reduce((s, d) => s + d.qty, 0),
      oldest: Math.max(...its.map((d) => d.days)),
      ready: its.filter((d) => d.ready).length,
    }));
    arr.sort((a, b) => {
      const au = isUnassignedGroup(a.name);
      const bu = isUnassignedGroup(b.name);
      if (au !== bu) return au ? -1 : 1;
      return b.oldest - a.oldest;
    });
    return arr;
  }, [crossFiltered, view]);

  // Klik kartu PIC langsung filter tabel Item Explorer (2026-09-03, instruksi
  // eksplisit user: JANGAN ada dropdown-list di dalam kartu, cukup 1 klik
  // langsung filter) -- klik kartu yg SAMA lagi = toggle-off (hapus filter),
  // sama pola dgn kartu KPI Status/Lama Proses di atas.
  function onOwnerHeadClick(name: string) {
    if (view === "customer") {
      setCustomerFilter((c) => (c === name ? null : name));
      setOwner(null);
      setSegmentFilter(null);
    } else if (view === "segment") {
      setSegmentFilter((s) => (s === name ? null : name));
      setOwner(null);
      setCustomerFilter(null);
    } else {
      setOwner((o) => (o && o.role === view && o.name === name ? null : { role: view, name }));
      setCustomerFilter(null);
      setSegmentFilter(null);
    }
    document.getElementById("open-approval-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const activeFilterBits: string[] = [];
  if (owner) activeFilterBits.push(`${owner.role === "tech" ? "Tech" : "Sales"} = ${owner.name === UNASSIGNED ? "none" : owner.name}`);
  if (customerFilter) activeFilterBits.push(`Customer = ${customerFilter}`);
  if (segmentFilter) activeFilterBits.push(`Cust Segmen = ${segmentFilter}`);
  if (bucket) activeFilterBits.push(`${bucket} days`);
  if (statusFilter) activeFilterBits.push(`Status = ${statusFilter}`);
  if (readyFilter !== "ALL") activeFilterBits.push({ ready: "Ready for sign-off", wip: "Not ready", notech: "No Tech PIC" }[readyFilter]);

  if (isLoading) return <div className="panel-body text-sm text-slate-500">Memuat worklist...</div>;

  // Kartu KPI utama (2026-09-03, instruksi eksplisit user: bisa diklik utk
  // filter tabel) -- dihitung dari `crossFiltered` (ikut plant, range
  // tanggal, DAN bucket "Lama Proses" yg aktif), supaya kartu status di sini
  // & kartu "Lama Proses" di bawah SALING kelihatan efeknya kalau salah satu
  // diklik (2026-09-04, laporan user: klik "Approval" tidak mempengaruhi
  // kartu "Lama Proses" -- root cause: dulu masing2 cuma pakai `base` polos).
  const okApprovalRows = crossFiltered.filter((i) => i.status === "Oke Approval");
  const approvalRows = crossFiltered.filter((i) => i.status === "Approval");
  const waitApprovalRows = crossFiltered.filter((i) => i.status === "Wait Approval");
  const improveRows = crossFiltered.filter((i) => i.needsImprove);
  const sumQty = (rows: WorklistItem[]) => rows.reduce((s, d) => s + d.qty, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-bold text-slate-800">Dashboard Approval</h2>
        <p className="mt-0.5 text-xs text-slate-500">Semua Order Approval, dikelompokkan per Tech/Sales PIC.</p>
      </div>

      {/* KPIs -- kartu bisa diklik utk filter tabel, sama pola dgn "Lama Proses" */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard
          label="Total Order"
          count={crossFiltered.length}
          qty={sumQty(crossFiltered)}
          color="#3498DB"
          onClick={() => setStatusFilter(null)}
          active={statusFilter === null}
          dimmed={statusFilter !== null}
        />
        <KpiCard
          label="Oke Approval"
          count={okApprovalRows.length}
          qty={sumQty(okApprovalRows)}
          color="#2ECC71"
          onClick={() => setStatusFilter((s) => (s === "Oke Approval" ? null : "Oke Approval"))}
          active={statusFilter === "Oke Approval"}
          dimmed={statusFilter !== null && statusFilter !== "Oke Approval"}
        />
        <KpiCard
          label="Approval"
          count={approvalRows.length}
          qty={sumQty(approvalRows)}
          color="#F1C40F"
          onClick={() => setStatusFilter((s) => (s === "Approval" ? null : "Approval"))}
          active={statusFilter === "Approval"}
          dimmed={statusFilter !== null && statusFilter !== "Approval"}
        />
        <KpiCard
          label="Improve"
          count={improveRows.length}
          qty={sumQty(improveRows)}
          color="#E74C3C"
          onClick={() => setStatusFilter((s) => (s === "Improve" ? null : "Improve"))}
          active={statusFilter === "Improve"}
          dimmed={statusFilter !== null && statusFilter !== "Improve"}
        />
        <KpiCard
          label="Wait Approval"
          count={waitApprovalRows.length}
          qty={sumQty(waitApprovalRows)}
          color="#E74C3C"
          onClick={() => setStatusFilter((s) => (s === "Wait Approval" ? null : "Wait Approval"))}
          active={statusFilter === "Wait Approval"}
          dimmed={statusFilter !== null && statusFilter !== "Wait Approval"}
        />
      </div>

      {/* Lama Proses -- kartu KPI bisa diklik utk filter tabel (2026-09-03,
          instruksi eksplisit user, gaya & perilaku disamakan dgn "Lama Proses"
          di Quality Check Review: kartu "Total" me-reset filter, kartu lain
          toggle single-select ke state `bucket` yg sama dipakai tabel di
          bawah). Dihitung dari `crossFiltered` (2026-09-04, laporan user:
          kartu ini sempat tidak ikut bereaksi saat kartu status "Approval"
          dkk diklik -- sekarang ikut, sama spt kartu status di atas). */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-700">Lama Proses</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard
            label="Total Order"
            count={crossFiltered.length}
            qty={sumQty(crossFiltered)}
            color="#3498DB"
            onClick={() => setBucket(null)}
            active={bucket === null}
            dimmed={bucket !== null}
          />
          {AGE_BUCKETS.map((b) => {
            const rows = crossFiltered.filter((i) => i.bucket === b.key);
            return (
              <KpiCard
                key={b.key}
                label={b.label}
                count={rows.length}
                qty={rows.reduce((s, d) => s + d.qty, 0)}
                color={b.color}
                onClick={() => setBucket(bucket === b.key ? null : b.key)}
                active={bucket === b.key}
                dimmed={bucket !== null && bucket !== b.key}
              />
            );
          })}
        </div>
      </div>

      {/* Owner cards */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-slate-700">Siapa yang pegang open approval</h3>
          <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">klik kartu untuk filter tabel</span>
        </div>
        {/* Baris gabungan Kelompokkan/Plant/Range waktu (2026-09-04, instruksi
            eksplisit user: urutan tombol Kelompokkan -> Plant -> Range waktu,
            gaya tombol Plant disamakan pakai class global `.btn`/`.btn-outline`
            yg sama, 3 tombol Plant digabung jadi 1 dropdown pola SAMA PERSIS
            dgn "☰ Kelompokkan" (radio single-select di dalam .panel). */}
        <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 12 }}>
          <div style={{ position: "relative" }}>
            {/* Gaya tombol disamakan persis dgn "☰ Status"/"☰ Lama Proses"/"☰
                Kolom" (2026-09-04, instruksi eksplisit user: dulu pakai Tailwind
                rose custom, kurang terlihat) -- class global `.btn`/`.btn-outline`
                (app.css), solid merah pas panel terbuka ATAU bukan default "tech",
                putih-outline selain itu. */}
            <button type="button" className={`btn ${showViewPanel || view !== "tech" ? "" : "btn-outline"}`} onClick={() => setShowViewPanel((s) => !s)}>
              ☰ Kelompokkan: {VIEW_LABEL[view]}
            </button>
            {showViewPanel && (
              <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 180, padding: 10 }}>
                {(Object.keys(VIEW_LABEL) as ViewMode[]).map((v) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="approval-groupby"
                      checked={view === v}
                      onChange={() => {
                        setView(v);
                        setShowViewPanel(false);
                      }}
                    />
                    By {VIEW_LABEL[v]}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`btn ${showPlantPanel || plant !== "ALL" ? "" : "btn-outline"}`}
              onClick={() => setShowPlantPanel((s) => !s)}
            >
              ☰ Plant: {plant === "ALL" ? "Semua" : plant}
            </button>
            {showPlantPanel && (
              <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 180, padding: 10 }}>
                {["ALL", ...plants].map((p) => (
                  <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="approval-plant"
                      checked={plant === p}
                      onChange={() => {
                        setPlant(p);
                        resetPlantScopedFilters();
                        setShowPlantPanel(false);
                      }}
                    />
                    {p === "ALL" ? "Semua" : p}
                    <span style={{ opacity: 0.75, marginLeft: 4 }}>{p === "ALL" ? items.length : items.filter((i) => i.plant === p).length}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <span className="text-xs font-semibold text-slate-600">Range waktu (Prepare Date):</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
          <span className="text-xs text-slate-400">s/d</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
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
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {groups.map((g) => {
            // `alert` cuma bisa "true" di view "tech"/"sales" (customer/segment
            // pakai fallback "UNKNOWN", bukan UNASSIGNED -- lihat `groups`).
            // Label kartu-nya DIPERBAIKI 2026-09-01 (ditemukan lewat laporan
            // user: kartu "⚠ No sales owner" tetap muncul walau lagi di view
            // "By Tech PIC", bikin bingung, PADAHAL kartunya lagi nunjukkin
            // Tech PIC yg kosong bukan Sales PIC) -- SEBELUMNYA teks "No sales
            // owner" di-hardcode apa pun view-nya, sekarang ikut
            // `VIEW_LABEL[view]` supaya sesuai role yg lagi ditampilkan.
            // Dropdown "☰"/Item Explorer di bawah JUGA ikut diganti jadi "No
            // Tech PIC" (filter `readyFilter === "notech"`, bukan lagi cek
            // Sales PIC) krn di data real Sales PIC SELALU terisi (0 kosong),
            // Tech PIC yg justru sering kosong (144 item saat laporan ini).
            //
            // Kartu dipindah ke komponen `KpiCard` (2026-09-03, instruksi
            // eksplisit user: border/box sebelumnya nyaris tak kelihatan
            // krn cuma border-slate-200 tipis -- `.panel` + border-top warna
            // jauh lebih jelas, sama gaya dgn kartu KPI lain di halaman ini).
            const alert = isUnassignedGroup(g.name);
            // Warna kartu PIC (2026-09-03, instruksi eksplisit user): satu
            // warna teal utk semua, KECUALI "No Tech/Sales PIC" tetap merah
            // (alert, perlu perhatian -- belum ada yg pegang).
            const color = alert ? "#E74C3C" : "#1ABC9C";
            const isActive =
              view === "customer" ? customerFilter === g.name : view === "segment" ? segmentFilter === g.name : owner?.role === view && owner?.name === g.name;
            const anyFilterActive = view === "customer" ? customerFilter !== null : view === "segment" ? segmentFilter !== null : owner !== null;
            return (
              <KpiCard
                key={g.name}
                label={alert ? `⚠ No ${VIEW_LABEL[view]}` : g.name}
                count={g.n}
                qty={g.qty}
                color={color}
                onClick={() => onOwnerHeadClick(g.name)}
                active={isActive}
                dimmed={anyFilterActive && !isActive}
                minWidth={130}
                padding={10}
                countFontSize="1.3rem"
                showQtyLabel={false}
                fullBorder
              />
            );
          })}
          {groups.length === 0 && <div className="text-sm text-slate-400">Tidak ada item terbuka.</div>}
        </div>
      </div>

      {/* Item explorer */}
      <div id="open-approval-table">
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-slate-700">Item explorer</h3>
          <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">
            {explorerRows.length} dari {base.length} item
          </span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <span>🔎</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="cari customer, SKU, PWO, nama..."
              className="w-full border-none bg-transparent p-0 text-sm shadow-none outline-none focus:ring-0"
            />
          </div>
          <select
            value={readyFilter}
            onChange={(e) => setReadyFilter(e.target.value as ReadyFilter)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="ALL">Semua item</option>
            <option value="ready">Ready sign-off saja</option>
            <option value="wip">Belum ready</option>
            <option value="notech">No Tech PIC</option>
          </select>
          <button onClick={clearFilters} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
            clear filters
          </button>
        </div>
        {activeFilterBits.length > 0 && <div className="mb-2 text-xs text-amber-600">▸ filtering: {activeFilterBits.join(" · ")}</div>}
        {deleteError && <p className="error-text">{deleteError}</p>}

        {/* Isi & format tabel SAMA PERSIS dgn "Approval — Lot History"
            (2026-09-04, instruksi eksplisit user) -- lihat komentar sync di
            `buildItemExplorerColumns` di atas. */}
        <DataTable
          rowKey={(r: LotHistoryRow) => r.approvalId}
          exportFileName="dashboard-approval-item-explorer"
          storageKey="dashboard-approval-item-explorer"
          rows={explorerRawRows}
          rowStyle={(r) => (r.needsImprove ? { background: "#fef2f2" } : undefined)}
          freezeFirstColumn
          columns={itemExplorerColumns}
        />
      </div>
    </div>
  );
}

/** Kartu KPI -- struktur SAMA PERSIS dgn KpiCard di Quality Check Review
 * (2026-09-03, instruksi eksplisit user): `.panel` + border atas 4px warna,
 * baris atas label + "Qty (Ltr): {qty}", baris "Qty Formula", angka besar
 * (count) di bawah. `onClick`/`active`/`dimmed` opsional (dipakai kartu "Lama
 * Proses" yg bisa diklik utk filter tabel; kartu status di atas tidak pakai
 * ini jadi tetap statis). */
function KpiCard({
  label,
  count,
  qty,
  color = "var(--navy-light)",
  caption = "Qty Formula",
  footer,
  onClick,
  active,
  dimmed,
  minWidth = 160,
  padding = 16,
  countFontSize = "1.8rem",
  showQtyLabel = true,
  fullBorder = false,
}: {
  label: string;
  count: number;
  qty: number;
  color?: string;
  /** Baris kecil di bawah label/qty -- default "Qty Formula" (kartu
   * Status/Lama Proses). Kartu PIC (2026-09-03: dipakai utk role "Tech PIC"
   * dkk, lalu DIHAPUS lagi 2026-09-04, instruksi eksplisit user) pass string
   * kosong "" supaya baris ini tidak dirender sama sekali. */
  caption?: string;
  /** Baris kecil OPSIONAL di bawah angka besar (2026-09-03, instruksi
   * eksplisit user: kartu PIC pakai ini utk label "No Order"). */
  footer?: string;
  onClick?: () => void;
  active?: boolean;
  dimmed?: boolean;
  /** Lebar minimum kartu. Default 160 (kartu KPI Status/Lama Proses). Kartu
   * PIC (2026-09-04, instruksi eksplisit user: dibuat LEBIH KECIL, jangan
   * sampai terlihat lebih besar dari kartu Lama Proses/Status) pakai angka
   * lebih kecil drpd 160 -- lihat pemakaiannya di bawah. */
  minWidth?: number;
  /** Padding dalam kartu (px). Default 16, kartu PIC pakai lebih kecil
   * (2026-09-04) supaya proporsinya ikut menyusut, bukan cuma lebarnya. */
  padding?: number;
  /** Ukuran font angka besar. Default "1.8rem", kartu PIC pakai lebih kecil
   * (2026-09-04) senada dgn `padding`/`minWidth` yg ikut dikecilkan. */
  countFontSize?: string;
  /** Sembunyikan label "Qty (Ltr):", cuma tampilkan nilainya (2026-09-03,
   * instruksi eksplisit user, dipakai kartu PIC). Default true. */
  showQtyLabel?: boolean;
  /** Border PENUH sekeliling kartu memakai `color`, bukan cuma strip atas
   * (2026-09-04, instruksi eksplisit user: kartu PIC selain "No Tech PIC"
   * nyaris tak kelihatan -- `.panel` cuma py border-slate-200 tipis di
   * sisi kiri/kanan/bawah, terlalu samar utk banyak kartu kecil berdempetan
   * spt kartu PIC). Default false (kartu Status/Lama Proses tetap strip atas
   * spt biasa, sudah cukup jelas krn lebih besar & lebih sedikit jumlahnya). */
  fullBorder?: boolean;
}) {
  return (
    <div
      className="panel"
      role={onClick ? "button" : undefined}
      onClick={onClick}
      title={label}
      style={{
        flex: `1 1 ${minWidth}px`,
        minWidth,
        padding,
        border: fullBorder ? `1.5px solid ${color}` : undefined,
        borderTop: `4px solid ${color}`,
        cursor: onClick ? "pointer" : undefined,
        boxShadow: active ? `0 0 0 2px ${color}` : undefined,
        opacity: dimmed ? 0.55 : 1,
        transition: "opacity 0.15s ease, box-shadow 0.15s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div
          style={{
            fontSize: "0.78rem",
            color: "var(--text-muted)",
            fontWeight: 600,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {showQtyLabel && "Qty (Ltr): "}
          <span>{fmt(qty)}</span>
        </div>
      </div>
      {caption && <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{caption}</div>}
      <div style={{ fontSize: countFontSize, fontWeight: 700, color: "var(--navy-dark)" }}>{count}</div>
      {footer && <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{footer}</div>}
    </div>
  );
}
