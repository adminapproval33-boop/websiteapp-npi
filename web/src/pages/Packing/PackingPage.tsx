import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import EmployeeNameSelect, {
  formatInputBy,
  isKnownEmployeeName,
  useEmployeeOptions,
  useNameSuggestions,
  normalizeMembers,
  displayNameWithNik,
  resolveEmployeeId,
  MemberEntry,
} from "../../components/EmployeeNameSelect";
import DataTable from "../../components/DataTable";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { computeQtyPerManFromPcsVolume } from "../../lib/qty";

/** Total Qty/Pcs seluruh Member (2026-08-10, instruksi eksplisit user) --
 * dulu 1 nilai Qty/Pcs dibagi rata per kepala, sekarang tiap Member punya
 * Qty/Pcs sendiri; field header "Qty/Pcs"/"Qty/Man (Ltr)" jadi TOTAL hasil
 * penjumlahan tiap Member, bukan lagi input manual dibagi rata. */
function sumMembersQtyPcs(members: { qtyPcs?: string }[]): number {
  return members.reduce((sum, m) => sum + (Number(m.qtyPcs) || 0), 0);
}

/** Total Qty/Man (Ltr) = Volume x total Qty/Pcs semua Member (bukan dibagi
 * jumlah Member lagi -- setiap Member sudah bawa hasil kerjanya sendiri). */
function computeTotalQtyPerMan(members: { qtyPcs?: string }[], volume: string): string {
  const totalPcs = sumMembersQtyPcs(members);
  if (totalPcs <= 0) return "";
  return computeQtyPerManFromPcsVolume(String(totalPcs), volume, 1);
}

/** True kalau total Qty/Man (Ltr) sudah melebihi Order Qty -- Order Qty jadi
 * batas atas total Qty/Man (Ltr) sesuai instruksi eksplisit user (2026-08-10):
 * kalau Admin mau total-nya lebih besar, Order Qty-nya harus dinaikkan dulu.
 * Order Qty kosong/bukan angka dianggap belum ada batas (tidak divalidasi). */
function totalQtyPerManExceedsOrderQty(qtyPerManTotal: string, orderQty: string): boolean {
  const total = Number(qtyPerManTotal);
  const limit = Number(orderQty);
  if (!qtyPerManTotal || Number.isNaN(total)) return false;
  if (!orderQty.trim() || Number.isNaN(limit)) return false;
  return total > limit;
}
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { handleExcelGridKeyNav } from "../../lib/excelGridNav";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). */
const PACKING_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 220,
  materialNumber: 200,
  materialDescription: 260,
  batch: 160,
  orderQty: 140,
  plant: 120,
  iuPlant: 160,
  codeTanki: 160,
  formReceived: 190,
  start: 190,
  finish: 190,
  spvName: 170,
  leaderName: 170,
  qtyPcs: 140,
  totalQty: 150,
  qtyPerMan: 150,
  member: 180,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const PACKING_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription"],
  ["batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki", "formReceived", "start", "finish"],
  ["spvName", "leaderName"],
  ["member", "qtyPcs", "totalQty", "qtyPerMan"],
];

interface HistoryRow {
  id: number;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  spvName: string;
  spvNik: string | null;
  members: (string | MemberEntry)[] | null;
  formReceived: string | null;
  start: string | null;
  leaderName: string | null;
  leaderNik: string | null;
  qtyPerMan: string | null;
  totalQty: string | null;
  qtyPcs: string | null;
  finish: string | null;
  codeTanki: string;
  remark: string | null;
  inputBy: string;
  attachments: { id: number; fileName: string; filePath: string }[];
}

/** Baris "List Antrian Packing" -- Order yg Admin QC Stage terbarunya sudah
 * punya QC Passed terisi dan belum diinput ke Packing (lihat GET
 * /packing/queue di packing.routes.ts). */
interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  typeLot: string | null;
  lotPassed: string | null;
  qcToApproval: string | null;
  qcPassed: string | null;
  remark: string | null;
}

/** "Kolom inti" Packing yg jadi syarat wajib di SEMUA tahap Proses granular di
 * bawah (SPV Produksi, Leader, Order, Material Number, Material Description,
 * Batch, Order Qty, Plant, IU Plant, Code Tanki, Volume) -- sesuai instruksi
 * eksplisit user (2026-07-24). "Volume" = kolom totalQty. Qty/Man SENGAJA
 * TIDAK dimasukkan di sini -- itu cuma syarat tahap Packing/Done, lihat
 * packingProcessLabel. */
function packingCoreFieldsFilled(r: HistoryRow): boolean {
  return Boolean(
    r.order &&
      r.materialNumber &&
      r.materialDescription &&
      r.batch &&
      r.orderQty &&
      r.plant &&
      r.iuPlant &&
      r.codeTanki &&
      r.spvName &&
      r.leaderName &&
      r.totalQty
  );
}

/**
 * Label Proses History Packing -- tahapan granular ditentukan dari kolom
 * PALING LANJUT yg sudah terisi (Form Received -> Start -> Finish), dgn
 * syarat "kolom inti" (lihat packingCoreFieldsFilled) DAN semua kolom tahap
 * sebelumnya juga sudah terisi -- sesuai instruksi eksplisit user (direvisi
 * 2026-07-24: kolom Qty/Man dimunculkan lagi, jadi syarat WAJIB tahap
 * "Packing" & "Done" -- TAPI BUKAN syarat tahap "QU - PC", sesuai instruksi
 * eksplisit). Dicek dari yg paling lanjut dulu (Finish) turun ke yg paling
 * awal (Form Received).
 */
function packingProcessLabel(r: HistoryRow): string {
  if (!packingCoreFieldsFilled(r)) return "-";
  if (r.finish && r.start && r.formReceived && r.qtyPerMan) return "Done";
  if (r.start && r.formReceived && r.qtyPerMan) return "Packing";
  if (r.formReceived) return "QU - PC";
  return "-";
}

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  spvName: "",
  spvNik: null as string | null,
  members: [] as MemberEntry[],
  qtyPerMan: "",
  totalQty: "",
  qtyPcs: "",
  formReceived: "",
  start: "",
  leaderName: "",
  leaderNik: null as string | null,
  finish: "",
  codeTanki: "",
  remark: "",
};

export default function PackingPage({
  embedded = false,
  initialOrder,
  onSaved,
}: {
  /** Mode ringkas dipakai pop-up "Tahap Selanjutnya" di Production Order
   * Monitoring (2026-07-31, instruksi eksplisit user) -- lihat komentar sama
   * di PremixAftermixPage.tsx. */
  embedded?: boolean;
  initialOrder?: string;
  onSaved?: () => void;
} = {}) {
  const { user } = useAuth();
  const isViewOnly = getMenuLevel(user, "packing") === "VIEW";
  const { data: employees } = useEmployeeOptions();
  const { data: spvSuggestions } = useNameSuggestions("packing", "spv");
  const { data: leaderSuggestions } = useNameSuggestions("packing", "leader");
  const { data: memberSuggestions } = useNameSuggestions("packing", "member");
  const { data: tanks } = useTankOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history" | "queue">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memberNameInput, setMemberNameInput] = useState("");
  const [memberNikInput, setMemberNikInput] = useState<string | null>(null);
  const [memberQtyPcsInput, setMemberQtyPcsInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    PACKING_COL_DEFAULT_WIDTHS,
    "packingColWidths",
    PACKING_COL_ROWS
  );
  /** Navigasi panah ala Excel antar ExcelField -- lihat lib/excelGridNav.ts. */
  const gridNav = (key: string) => ({ navKey: key, onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleExcelGridKeyNav(e, PACKING_COL_ROWS) });

  const historyQuery = useQuery({
    queryKey: ["packing-history"],
    queryFn: () => api.get<{ success: boolean; data: HistoryRow[] }>("/packing/history").then((r) => r.data),
    // Mode "embedded" (pop-up "Tahap Selanjutnya", 2026-07-31) cuma
    // nampilin form Input -- lihat komentar sama di PremixAftermixPage.tsx.
    enabled: !embedded,
  });

  const queueQuery = useQuery({
    queryKey: ["packing-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/packing/queue").then((r) => r.data),
    enabled: !embedded,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form };
      return editingId
        ? api.put<{ success: boolean; data: HistoryRow }>(`/packing/${editingId}`, payload)
        : api.post<{ success: boolean; data: HistoryRow }>("/packing", payload);
    },
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["packing-history"] });
      queryClient.invalidateQueries({ queryKey: ["packing-queue"] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data Packing berhasil diperbarui." : "Data Packing berhasil disimpan.");
      }
      onSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/packing/${id}`),
    onSuccess: () => {
      setMessage("Data Packing berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["packing-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/packing/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["packing-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => {
      const orderQty = data.orderQty ?? "";
      // Volume diambil dari Referensi Order/PO (SAP-COOISPI) kolom Volume,
      // sesuai instruksi eksplisit user -- fallback ke Order Qty kalau
      // kolom Volume kosong di Master Data (spt sebelumnya).
      const totalQty = data.volume || orderQty;
      return {
        ...f,
        materialNumber: data.materialNumber ?? "",
        materialDescription: data.materialDescription ?? "",
        batch: data.batch ?? "",
        orderQty,
        plant: data.plant ?? "",
        // Qty/Man (Ltr) = Volume x total Qty/Pcs semua Member (2026-08-10,
        // direvisi dari versi lama yg dibagi rata per kepala -- lihat
        // computeTotalQtyPerMan).
        qtyPerMan: computeTotalQtyPerMan(f.members, totalQty),
        totalQty,
      };
    });
    try {
      const res = await api.get<{ success: boolean; data: { iuPlant: string; codeTanki: string } | null }>(
        `/master-data/order-context/${encodeURIComponent(data.order)}`
      );
      if (res.data) {
        setForm((f) => ({
          ...f,
          iuPlant: res.data!.iuPlant || f.iuPlant,
          codeTanki: res.data!.codeTanki || f.codeTanki,
        }));
      }
    } catch {
      /* saran IU Plant/Code Tanki bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
    // Kolom lain (SPV Produksi, Leader, Member, Start, Finish, Remark) diambil
    // dari input TERAKHIR untuk Order ini di Packing (bukan lintas modul) --
    // Remark SENGAJA tidak ikut disarankan dari order-context lintas modul di atas.
    try {
      const latestRes = await api.get<{ success: boolean; data: HistoryRow | null }>(
        `/packing/latest-by-order/${encodeURIComponent(data.order)}`
      );
      const latest = latestRes.data;
      if (latest) {
        // Order ini sudah pernah diinput -- masuk mode Edit record yang sama
        // (bukan bikin baris baru) supaya History tetap 1 baris per Order:
        // data baru akan menimpa/replace data lama saat Save.
        setEditingId(latest.id);
        setForm((f) => {
          const members = f.members.length > 0 ? f.members : normalizeMembers(latest.members);
          const memberPcsSum = sumMembersQtyPcs(members);
          const totalQty = f.totalQty || latest.totalQty || "";
          // Baris lama (sebelum Qty/Pcs per-Member) belum punya qtyPcs di tiap
          // Member -- fallback ke nilai total lama yg tersimpan supaya data
          // historis tetap tampil apa adanya, bukan tiba-tiba jadi 0.
          const qtyPcs = memberPcsSum > 0 ? String(memberPcsSum) : f.qtyPcs || latest.qtyPcs || "";
          const qtyPerMan = memberPcsSum > 0 ? computeTotalQtyPerMan(members, totalQty) : f.qtyPerMan || latest.qtyPerMan || "";
          return {
            ...f,
            spvName: f.spvName || latest.spvName || "",
            spvNik: f.spvName ? f.spvNik : latest.spvNik ?? null,
            leaderName: f.leaderName || latest.leaderName || "",
            leaderNik: f.leaderName ? f.leaderNik : latest.leaderNik ?? null,
            members,
            formReceived: f.formReceived || latest.formReceived || "",
            start: f.start || latest.start || "",
            finish: f.finish || latest.finish || "",
            remark: f.remark || latest.remark || "",
            qtyPcs,
            totalQty,
            qtyPerMan,
          };
        });
      } else {
        setEditingId(null);
      }
    } catch {
      /* belum ada input sebelumnya untuk Order ini -- biarkan kosong */
    }
  }

  // Mode pop-up "Tahap Selanjutnya" (embedded+initialOrder) -- lihat komentar
  // sama di PremixAftermixPage.tsx. Cleanup placeholder "-" di volume
  // direplikasi manual (biasanya dilakukan OrderLookup sendiri), krn
  // panggilan API-nya langsung, tidak lewat komponen OrderLookup.
  useEffect(() => {
    if (!embedded || !initialOrder) return;
    setForm((f) => ({ ...f, order: initialOrder }));
    const cleanPlaceholder = (v: string | null) => {
      const trimmed = (v ?? "").trim();
      return trimmed === "" || trimmed === "-" ? null : v;
    };
    api
      .get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(initialOrder)}`)
      .then((res) => handleOrderFound({ ...res.data, volume: cleanPlaceholder(res.data.volume) }))
      .catch(() => {
        /* Order tidak ditemukan di Master Data -- biarkan kosong, user isi manual */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialOrder]);

  /** Isi Order dari List Antrian Packing ke form Input Packing (lewat alur
   * handleOrderFound yg sama dgn ketik manual di OrderLookup), supaya
   * Material/Batch/Qty/Plant/IU Plant/Code Tanki tersaran otomatis begitu
   * tim Packing mengambil Order ini dari antrian. */
  async function loadIntoInput(row: QueueRow) {
    setForm((f) => ({ ...f, order: row.order }));
    await handleOrderFound({
      order: row.order,
      batch: row.batch,
      materialNumber: row.materialNumber,
      materialDescription: row.materialDescription,
      orderQty: row.orderQty,
      plant: row.plant,
      jenis: null,
      warnaDasar: null,
      volume: null,
    });
    // IU Plant/Code Tanki dari Admin QC Order ini lebih akurat drpd saran
    // order-context umum di handleOrderFound -- pakai sbg fallback terakhir
    // kalau belum kesisi dari sumber lain.
    setForm((f) => ({
      ...f,
      iuPlant: f.iuPlant || row.iuPlant || "",
      codeTanki: f.codeTanki || row.codeTanki || "",
    }));
    setTab("input");
    setMessage("");
    setError("");
  }

  function handleOrderQtyChange(orderQty: string) {
    // Qty/Man (Ltr) SENGAJA tidak lagi dihitung ulang di sini -- rumusnya
    // sekarang Qty/Pcs x Volume, tidak terkait Order Qty (lihat lib/qty.ts).
    setForm((f) => ({ ...f, orderQty }));
  }

  function addMember() {
    const name = memberNameInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    // Qty/Pcs WAJIB per-Member (2026-08-10, instruksi eksplisit user) -- supaya
    // hasil kerja tiap orang dicatat apa adanya, bukan dibagi rata ke semua
    // Member walau hasilnya beda-beda.
    const qtyPcs = memberQtyPcsInput.trim();
    if (!qtyPcs || Number.isNaN(Number(qtyPcs))) {
      setError("Qty/Pcs untuk Member ini wajib diisi (angka) sebelum ditambahkan.");
      return;
    }
    const prospectiveMembers = [...form.members, { name, nik: memberNikInput, qtyPcs }];
    const prospectiveQtyPerMan = computeTotalQtyPerMan(prospectiveMembers, form.totalQty);
    if (totalQtyPerManExceedsOrderQty(prospectiveQtyPerMan, form.orderQty)) {
      setError(
        `Total Qty/Man (Ltr) akan menjadi ${prospectiveQtyPerMan} Ltr, melebihi Order Qty (${form.orderQty}). Naikkan Order Qty dulu kalau memang ingin lebih.`
      );
      return;
    }
    setError("");
    setForm((f) => {
      const members = [...f.members, { name, nik: memberNikInput, qtyPcs }];
      const next = { ...f, members, qtyPcs: String(sumMembersQtyPcs(members)), qtyPerMan: computeTotalQtyPerMan(members, f.totalQty) };
      // Form Received & Start otomatis terisi jam SEKARANG begitu Member pertama
      // ditambahkan (2026-08-20, instruksi eksplisit user: percepat input admin) --
      // HANYA kalau masih kosong, supaya tidak menimpa tanggal yang sudah diisi/
      // direvisi manual.
      const now = toDateTimeLocalValue(new Date());
      if (!next.formReceived) next.formReceived = now;
      if (!next.start) next.start = now;
      return next;
    });
    setMemberNameInput("");
    setMemberNikInput(null);
    setMemberQtyPcsInput("");
  }

  function removeLastMember() {
    setForm((f) => {
      const members = f.members.slice(0, -1);
      return { ...f, members, qtyPcs: String(sumMembersQtyPcs(members)), qtyPerMan: computeTotalQtyPerMan(members, f.totalQty) };
    });
  }

  function removeMemberAt(idx: number) {
    setForm((f) => {
      const members = f.members.filter((_, i) => i !== idx);
      return { ...f, members, qtyPcs: String(sumMembersQtyPcs(members)), qtyPerMan: computeTotalQtyPerMan(members, f.totalQty) };
    });
  }

  function startEdit(row: HistoryRow) {
    setEditingId(row.id);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch,
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      spvName: row.spvName,
      spvNik: row.spvNik ?? null,
      members: normalizeMembers(row.members),
      qtyPerMan: row.qtyPerMan ?? "",
      totalQty: row.totalQty ?? "",
      qtyPcs: row.qtyPcs ?? "",
      formReceived: row.formReceived ?? "",
      start: row.start ?? "",
      leaderName: row.leaderName ?? "",
      leaderNik: row.leaderNik ?? null,
      finish: row.finish ?? "",
      codeTanki: row.codeTanki,
      remark: row.remark ?? "",
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isKnownEmployeeName(employees, form.spvName)) {
      setError("SPV Produksi tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownEmployeeName(employees, form.leaderName)) {
      setError("Leader tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownTankCode(tanks, form.codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    if ((form.start || form.finish) && form.members.length === 0) {
      setError("Member wajib diisi kalau Start atau Finish sudah diisi.");
      return;
    }
    if (totalQtyPerManExceedsOrderQty(form.qtyPerMan, form.orderQty)) {
      setError(
        `Total Qty/Man (Ltr) (${form.qtyPerMan} Ltr) melebihi Order Qty (${form.orderQty}). Naikkan Order Qty dulu kalau memang ingin lebih.`
      );
      return;
    }
    saveMutation.mutate();
  }

  const filteredHistory = (historyQuery.data ?? []).filter((row) =>
    search.trim() ? row.order.toLowerCase().includes(search.trim().toLowerCase()) : true
  );

  const filteredQueue = (queueQuery.data ?? []).filter((row) =>
    queueSearch.trim() ? row.order.toLowerCase().includes(queueSearch.trim().toLowerCase()) : true
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          {!isViewOnly && (
            <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
              Input Packing
            </button>
          )}
          <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
            History
          </button>
          <button className={`btn ${tab === "queue" ? "" : "btn-outline"}`} onClick={() => setTab("queue")}>
            List Antrian Packing
          </button>
        </div>
      )}

      {(embedded || tab === "input") && (
        <div className="panel">
          <form className="panel-body" onSubmit={handleSubmit}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <ExcelBlock title="Production & MRP Schedule » Packing, Input Proses">
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")} {...gridNav("order")}>
                  <OrderLookup bare value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")} {...gridNav("materialNumber")}>
                  <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} />
                </ExcelField>
                <ExcelField label="Material Description" widthPx={colWidths.materialDescription} onResizeStart={beginResize("materialDescription")} {...gridNav("materialDescription")}>
                  <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Batch" widthPx={colWidths.batch} onResizeStart={beginResize("batch")} {...gridNav("batch")}>
                  <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={colWidths.orderQty} onResizeStart={beginResize("orderQty")} {...gridNav("orderQty")}>
                  <input value={form.orderQty} onChange={(e) => handleOrderQtyChange(e.target.value)} />
                </ExcelField>
                <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")} {...gridNav("plant")}>
                  <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={colWidths.iuPlant} onResizeStart={beginResize("iuPlant")} {...gridNav("iuPlant")}>
                  <IuPlantSelect bare id="packing-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")} {...gridNav("codeTanki")}>
                  <TankSelect bare id="packing-tank" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
                </ExcelField>
                <ExcelField label="Form Received" widthPx={colWidths.formReceived} onResizeStart={beginResize("formReceived")} {...gridNav("formReceived")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.formReceived)}
                    onChange={(e) => setForm({ ...form, formReceived: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Start" widthPx={colWidths.start} onResizeStart={beginResize("start")} {...gridNav("start")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.start)}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Finish" widthPx={colWidths.finish} onResizeStart={beginResize("finish")} {...gridNav("finish")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.finish)}
                    onChange={(e) => setForm({ ...form, finish: e.target.value })}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvName} onResizeStart={beginResize("spvName")} {...gridNav("spvName")}>
                  <EmployeeNameSelect
                    bare
                    id="packing-spv"
                    value={form.spvName}
                    employeeId={form.spvNik}
                    onChange={(v, nik) => setForm({ ...form, spvName: v, spvNik: nik ?? null })}
                    suggestions={spvSuggestions}
                    required
                  />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leaderName} onResizeStart={beginResize("leaderName")} {...gridNav("leaderName")}>
                  <EmployeeNameSelect
                    bare
                    id="packing-leader"
                    value={form.leaderName}
                    employeeId={form.leaderNik}
                    onChange={(v, nik) => setForm({ ...form, leaderName: v, leaderNik: nik ?? null })}
                    suggestions={leaderSuggestions}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Member" color="orange" widthPx={colWidths.member} onResizeStart={beginResize("member")} {...gridNav("member")}>
                  <EmployeeNameSelect
                    bare
                    id="packing-member"
                    value={memberNameInput}
                    employeeId={memberNikInput}
                    onChange={(v, nik) => {
                      setMemberNameInput(v);
                      setMemberNikInput(nik ?? null);
                    }}
                    suggestions={memberSuggestions}
                    placeholder="Nama anggota"
                  />
                </ExcelField>
                <ExcelField label="Qty/Pcs" color="orange" widthPx={colWidths.qtyPcs} onResizeStart={beginResize("qtyPcs")} {...gridNav("qtyPcs")}>
                  <input
                    value={memberQtyPcsInput}
                    onChange={(e) => setMemberQtyPcsInput(e.target.value)}
                    placeholder="Hasil Member ini"
                    title="Qty/Pcs hasil kerja Member yang akan ditambahkan (bukan total tim) -- setiap Member dicatat sendiri-sendiri, tidak dibagi rata"
                  />
                </ExcelField>
                <ExcelField label="Volume" color="orange" widthPx={colWidths.totalQty} onResizeStart={beginResize("totalQty")} {...gridNav("totalQty")}>
                  <input
                    value={form.totalQty}
                    onChange={(e) => {
                      const totalQty = e.target.value;
                      setForm((f) => ({ ...f, totalQty, qtyPerMan: computeTotalQtyPerMan(f.members, totalQty) }));
                    }}
                    title="Otomatis: Volume dari Referensi Order/PO (SAP-COOISPI), fallback ke Order Qty -- bisa diubah manual bila perlu"
                  />
                </ExcelField>
                <ExcelField label="Qty/Man (Ltr)" color="orange" widthPx={colWidths.qtyPerMan} onResizeStart={beginResize("qtyPerMan")} {...gridNav("qtyPerMan")}>
                  <input
                    value={computeQtyPerManFromPcsVolume(memberQtyPcsInput, form.totalQty, 1)}
                    readOnly
                    title="Preview hasil Member yang akan ditambahkan = Qty/Pcs x Volume (klik + utk simpan ke daftar Member)"
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <div className="excel-cell" style={{ flexBasis: "20%", maxWidth: "20%", flexDirection: "row", gap: 4, padding: 4 }}>
                  <button
                    type="button"
                    className="btn btn-info"
                    title="Tambah Member"
                    aria-label="Tambah Member"
                    style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
                    onClick={addMember}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    title="Kurangi Member"
                    aria-label="Kurangi Member"
                    style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
                    onClick={removeLastMember}
                    disabled={form.members.length === 0}
                  >
                    −
                  </button>
                </div>
              </ExcelRow>
              {form.members.length > 0 && (
                <ExcelRow>
                  <div className="excel-member-cell" style={{ flexBasis: "100%", maxWidth: "100%" }}>
                    <div className="excel-member-list">
                      {form.members.map((m, idx) => (
                        <span key={idx} className="excel-member-chip">
                          <span>
                            {m.name} — {m.qtyPcs || "0"} pcs — {computeQtyPerManFromPcsVolume(m.qtyPcs || "0", form.totalQty, 1) || "0"} Ltr
                          </span>
                          <button
                            type="button"
                            title="Hapus Member ini"
                            aria-label="Hapus Member ini"
                            onClick={() => removeMemberAt(idx)}
                            style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontWeight: 700 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: "0.82rem", fontWeight: 600 }}>
                      Total: {form.qtyPcs || 0} Pcs = {form.qtyPerMan || 0} Ltr ({form.members.length} member) -- dihitung per orang, tidak dibagi rata.
                    </div>
                    {totalQtyPerManExceedsOrderQty(form.qtyPerMan, form.orderQty) && (
                      <div style={{ marginTop: 4, fontSize: "0.82rem", fontWeight: 600, color: "var(--danger)" }}>
                        ⚠ Total Qty/Man (Ltr) ({form.qtyPerMan} Ltr) sudah melebihi Order Qty ({form.orderQty}). Naikkan
                        dulu Order Qty kalau memang ingin totalnya lebih besar.
                      </div>
                    )}
                  </div>
                </ExcelRow>
              )}
            </ExcelBlock>

            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Remark</label>
                <button type="button" className="btn btn-info" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
                  Upload File
                </button>
                {attachmentFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachmentFile.name}</span>}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <textarea rows={5} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-success" type="submit" disabled={saveMutation.isPending || uploadMutation.isPending}>
                {saveMutation.isPending || uploadMutation.isPending ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Save Data"}
              </button>
              {editingId && (
                <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                  Batal Edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">History Packing</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: HistoryRow) => r.id}
              exportFileName="history-packing"
              storageKey="packing-history"
              rows={filteredHistory}
              columns={[
                {
                  key: "timestamp",
                  label: "Timestamp",
                  render: (r) => formatDateTime(r.timestamp),
                  csvValue: (r) => toExcelDateTimeString(r.timestamp),
                },
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "process", label: "Proses", render: (r) => packingProcessLabel(r), csvValue: (r) => packingProcessLabel(r) },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "spvName", label: "SPV Produksi", render: (r) => r.spvName },
                { key: "spvEmployeeId", label: "SPV Employee ID", render: (r) => resolveEmployeeId(employees, r.spvName, r.spvNik) },
                { key: "leaderName", label: "Leader", render: (r) => r.leaderName },
                { key: "leaderEmployeeId", label: "Leader Employee ID", render: (r) => resolveEmployeeId(employees, r.leaderName, r.leaderNik) },
                {
                  key: "members",
                  label: "Member",
                  render: (r) => {
                    const members = normalizeMembers(r.members);
                    const list = members.map((m) => `${displayNameWithNik(employees, m.name, m.nik)} (${m.qtyPcs || "0"} pcs)`);
                    return [String(members.length), ...list].join(" | ");
                  },
                },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
                {
                  key: "formReceived",
                  label: "Form Received",
                  render: (r) => (r.formReceived ? formatDateTime(r.formReceived) : ""),
                  csvValue: (r) => (r.formReceived ? toExcelDateTimeString(r.formReceived) : ""),
                },
                {
                  key: "start",
                  label: "Start",
                  render: (r) => formatDateTime(r.start),
                  csvValue: (r) => toExcelDateTimeString(r.start),
                },
                {
                  key: "finish",
                  label: "Finish",
                  render: (r) => formatDateTime(r.finish),
                  csvValue: (r) => toExcelDateTimeString(r.finish),
                },
                { key: "qtyPcs", label: "Qty/Pcs", render: (r) => r.qtyPcs },
                { key: "totalQty", label: "Volume", render: (r) => r.totalQty },
                { key: "qtyPerMan", label: "Qty/Man (Ltr)", render: (r) => r.qtyPerMan },
                { key: "remark", label: "Remark", render: (r) => r.remark },
                { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
                { key: "attachments", label: "Lampiran", render: (r) => (r.attachments.length ? `${r.attachments.length} file` : "-") },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                        ✏️
                      </button>
                      {getMenuLevel(user, "packing") === "INPUT" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data Packing untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
                          }}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          </div>
        </div>
      )}

      {tab === "queue" && (
        <div className="panel">
          <div className="panel-header">List Antrian Packing</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              Order yang Admin QC Stage-nya (menu Input Admin QC) sudah punya QC Passed terisi dan sedang menunggu
              diinput ke Packing -- diurutkan yang paling lama menunggu duluan (FIFO). Order otomatis hilang dari
              daftar ini begitu sudah ada input Packing untuk Order tersebut.
            </p>
            <input
              placeholder="Cari nomor Order..."
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: QueueRow) => r.order}
              exportFileName="list-antrian-packing"
              storageKey="packing-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
                { key: "typeLot", label: "Admin QC Stage", render: (r) => r.typeLot },
                {
                  key: "lotPassed",
                  label: "Lot Passed",
                  render: (r) => formatDateTime(r.lotPassed),
                  csvValue: (r) => toExcelDateTimeString(r.lotPassed),
                },
                {
                  key: "qcToApproval",
                  label: "QC to App",
                  render: (r) => formatDateTime(r.qcToApproval),
                  csvValue: (r) => toExcelDateTimeString(r.qcToApproval),
                },
                {
                  key: "qcPassed",
                  label: "QC Passed",
                  render: (r) => formatDateTime(r.qcPassed),
                  csvValue: (r) => toExcelDateTimeString(r.qcPassed),
                },
                { key: "remark", label: "Remark (Admin QC)", render: (r) => r.remark },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <button
                      className="btn btn-outline"
                      type="button"
                      style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                      onClick={() => loadIntoInput(r)}
                    >
                      Input Packing
                    </button>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
