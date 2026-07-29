import { FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import EmployeeNameSelect, { isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import DataTable from "../../components/DataTable";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { computeFormPerMan } from "../../lib/qty";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). */
const COLOUR_MATCHING_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 220,
  materialNumber: 200,
  materialDescription: 260,
  batch: 160,
  orderQty: 140,
  plant: 120,
  iuPlant: 140,
  codeTanki: 150,
  typesOfProducts: 220,
  baseColor: 200,
  spvName: 170,
  leaderName: 170,
  formReceived: 190,
  start: 190,
  finish: 190,
  formPerMan: 150,
  member: 180,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const COLOUR_MATCHING_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription"],
  ["batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki", "typesOfProducts", "baseColor"],
  ["spvName", "leaderName", "formReceived", "start", "finish", "formPerMan"],
  ["member"],
];

/** Baris antrian "PWO Schedule & Queue" -- sumbernya History Aftermix (bukan
 * History Colour Matching sendiri), lihat GET /colour-matching/pwo-queue. */
interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string;
  spvProduksi: string;
  leader: string | null;
  members: string[] | null;
  qtyPerMan: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string;
  remark: string | null;
}

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
  codeTanki: string;
  typesOfProducts: string | null;
  baseColor: string | null;
  formPerMan: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string | null;
  spvName: string;
  leaderName: string | null;
  members: string[] | null;
  remark: string | null;
  inputBy: string;
  attachments: { id: number; fileName: string; filePath: string }[];
}

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  codeTanki: "",
  typesOfProducts: "",
  baseColor: "",
  formPerMan: "",
  formReceived: "",
  start: "",
  finish: "",
  spvName: "",
  leaderName: "",
  members: [] as string[],
  remark: "",
};

export default function ColourMatchingPage() {
  const { user } = useAuth();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history" | "queue">("input");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    COLOUR_MATCHING_COL_DEFAULT_WIDTHS,
    "colourMatchingColWidths",
    COLOUR_MATCHING_COL_ROWS
  );

  const historyQuery = useQuery({
    queryKey: ["colour-matching-history"],
    queryFn: () => api.get<{ success: boolean; data: HistoryRow[] }>("/colour-matching/history").then((r) => r.data),
  });

  const queueQuery = useQuery({
    queryKey: ["colour-matching-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/colour-matching/pwo-queue").then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? api.put<{ success: boolean; data: HistoryRow }>(`/colour-matching/${editingId}`, form)
        : api.post<{ success: boolean; data: HistoryRow }>("/colour-matching", form),
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["colour-matching-history"] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data Colour Matching berhasil diperbarui." : "Data Colour Matching berhasil disimpan.");
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/colour-matching/${id}`),
    onSuccess: () => {
      setMessage("Data Colour Matching berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["colour-matching-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/colour-matching/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["colour-matching-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => {
      const orderQty = data.orderQty ?? "";
      return {
        ...f,
        materialNumber: data.materialNumber ?? "",
        materialDescription: data.materialDescription ?? "",
        batch: data.batch ?? "",
        orderQty,
        plant: data.plant ?? "",
        // Types of Products & Base Color diambil dari Referensi Order/PO
        // (SAP-COOISPI) kolom JENIS & WARNA DASAR, sesuai instruksi eksplisit
        // user -- fallback ke histori Colour Matching sendiri (lihat blok
        // latest-by-order di bawah) kalau kolom ini kosong di Master Data.
        typesOfProducts: data.jenis || f.typesOfProducts,
        baseColor: data.warnaDasar || f.baseColor,
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
    // Kolom lain (SPV Produksi, Leader, Member, Types of Products, Base Color,
    // Form Received, Start, Finish, Remark) diambil dari input TERAKHIR untuk
    // Order ini di Colour Matching (bukan lintas modul) -- Remark SENGAJA
    // tidak ikut disarankan dari order-context lintas modul di atas.
    try {
      const latestRes = await api.get<{ success: boolean; data: HistoryRow | null }>(
        `/colour-matching/latest-by-order/${encodeURIComponent(data.order)}`
      );
      const latest = latestRes.data;
      if (latest) {
        // Order ini sudah pernah diinput -- masuk mode Edit record yang sama
        // (bukan bikin baris baru) supaya History tetap 1 baris per Order:
        // data baru akan menimpa/replace data lama saat Save.
        setEditingId(latest.id);
        setForm((f) => {
          const members = f.members.length > 0 ? f.members : latest.members ?? [];
          return {
            ...f,
            spvName: f.spvName || latest.spvName || "",
            leaderName: f.leaderName || latest.leaderName || "",
            members,
            typesOfProducts: f.typesOfProducts || latest.typesOfProducts || "",
            baseColor: f.baseColor || latest.baseColor || "",
            formReceived: f.formReceived || latest.formReceived || "",
            start: f.start || latest.start || "",
            finish: f.finish || latest.finish || "",
            remark: f.remark || latest.remark || "",
            formPerMan: computeFormPerMan(members.length),
          };
        });
      } else {
        setEditingId(null);
      }
    } catch {
      /* belum ada input sebelumnya untuk Order ini -- biarkan kosong */
    }
  }

  function handleOrderQtyChange(orderQty: string) {
    setForm((f) => ({ ...f, orderQty }));
  }

  function addMember() {
    const name = memberInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    setError("");
    setForm((f) => {
      const members = [...f.members, name];
      return { ...f, members, formPerMan: computeFormPerMan(members.length) };
    });
    setMemberInput("");
  }

  function removeLastMember() {
    setForm((f) => {
      const members = f.members.slice(0, -1);
      return { ...f, members, formPerMan: computeFormPerMan(members.length) };
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
      codeTanki: row.codeTanki,
      typesOfProducts: row.typesOfProducts ?? "",
      baseColor: row.baseColor ?? "",
      formPerMan: row.formPerMan ?? "",
      formReceived: row.formReceived ?? "",
      start: row.start ?? "",
      finish: row.finish ?? "",
      spvName: row.spvName,
      leaderName: row.leaderName ?? "",
      members: row.members ?? [],
      remark: row.remark ?? "",
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  /** Isi Order dari PWO Schedule & Queue ke form Input Colour Matching (lewat
   * alur handleOrderFound yg sama dgn ketik manual di OrderLookup) -- sama
   * pola dgn loadIntoInput di MillingPage.tsx/PremixAftermixPage.tsx. */
  function loadIntoInput(row: QueueRow) {
    setForm((f) => ({ ...f, order: row.order }));
    handleOrderFound({
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
    const hasMembers = form.members.length > 0;
    const hasStart = form.start.trim() !== "";
    const hasFinish = form.finish.trim() !== "";
    if (hasMembers || hasStart) {
      if (!hasMembers) {
        setError("Member wajib diisi kalau Start sudah diisi.");
        return;
      }
      if (!hasStart) {
        setError("Start wajib diisi kalau Member sudah diisi.");
        return;
      }
    }
    if (hasFinish && !hasStart) {
      setError("Finish hanya boleh diisi kalau Start sudah diisi.");
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

  function findEmployee(name: string | null) {
    const trimmed = (name ?? "").trim().toLowerCase();
    if (!trimmed) return undefined;
    return (employees ?? []).find((e) => e.fullName.trim().toLowerCase() === trimmed);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
          Input Colour Matching
        </button>
        <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
          History
        </button>
        <button className={`btn ${tab === "queue" ? "" : "btn-outline"}`} onClick={() => setTab("queue")}>
          PWO Schedule &amp; Queue
        </button>
      </div>

      {tab === "input" && (
        <div className="panel">
          <form className="panel-body" onSubmit={handleSubmit}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <ExcelBlock title="Production & MRP Schedule » Colour Matching, Input Proses">
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")}>
                  <OrderLookup bare value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")}>
                  <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} />
                </ExcelField>
                <ExcelField label="Material Description" widthPx={colWidths.materialDescription} onResizeStart={beginResize("materialDescription")}>
                  <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Batch" widthPx={colWidths.batch} onResizeStart={beginResize("batch")}>
                  <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={colWidths.orderQty} onResizeStart={beginResize("orderQty")}>
                  <input value={form.orderQty} onChange={(e) => handleOrderQtyChange(e.target.value)} />
                </ExcelField>
                <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")}>
                  <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={colWidths.iuPlant} onResizeStart={beginResize("iuPlant")}>
                  <IuPlantSelect bare id="colour-matching-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")}>
                  <TankSelect bare id="colour-matching-tank" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
                </ExcelField>
                <ExcelField label="Types of Products" widthPx={colWidths.typesOfProducts} onResizeStart={beginResize("typesOfProducts")}>
                  <input value={form.typesOfProducts} onChange={(e) => setForm({ ...form, typesOfProducts: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Base Color" widthPx={colWidths.baseColor} onResizeStart={beginResize("baseColor")}>
                  <input value={form.baseColor} onChange={(e) => setForm({ ...form, baseColor: e.target.value })} required />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvName} onResizeStart={beginResize("spvName")}>
                  <EmployeeNameSelect bare id="colour-matching-spv" value={form.spvName} onChange={(v) => setForm({ ...form, spvName: v })} required />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leaderName} onResizeStart={beginResize("leaderName")}>
                  <EmployeeNameSelect bare id="colour-matching-leader" value={form.leaderName} onChange={(v) => setForm({ ...form, leaderName: v })} required />
                </ExcelField>
                <ExcelField label="Form Received" widthPx={colWidths.formReceived} onResizeStart={beginResize("formReceived")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.formReceived)}
                    onChange={(e) => setForm({ ...form, formReceived: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Start" widthPx={colWidths.start} onResizeStart={beginResize("start")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.start)}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Finish" widthPx={colWidths.finish} onResizeStart={beginResize("finish")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.finish)}
                    onChange={(e) => setForm({ ...form, finish: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Form/Man" color="orange" widthPx={colWidths.formPerMan} onResizeStart={beginResize("formPerMan")}>
                  <input
                    value={form.formPerMan}
                    onChange={(e) => setForm({ ...form, formPerMan: e.target.value })}
                    title="Otomatis: 1 No Order ÷ jumlah Member -- bisa diubah manual bila perlu"
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Member" widthPx={colWidths.member} onResizeStart={beginResize("member")}>
                  <EmployeeNameSelect bare id="colour-matching-member" value={memberInput} onChange={setMemberInput} placeholder="Nama anggota" />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <div className="excel-cell" style={{ flexBasis: "15%", maxWidth: "15%", flexDirection: "row", gap: 4, padding: 4 }}>
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
                  <div className="excel-member-cell" style={{ flexBasis: "50%", maxWidth: "50%" }}>
                    <div className="excel-member-list">
                      {form.members.map((m, idx) => (
                        <span key={idx} className="excel-member-chip">
                          {m}
                        </span>
                      ))}
                    </div>
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
          <div className="panel-header">History Colour Matching</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: HistoryRow) => r.id}
              exportFileName="history-colour-matching"
              storageKey="colour-matching-history"
              rows={filteredHistory}
              columns={[
                {
                  key: "timestamp",
                  label: "Timestamp",
                  render: (r) => formatDateTime(r.timestamp),
                  csvValue: (r) => toExcelDateTimeString(r.timestamp),
                },
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "spvName", label: "SPV Produksi", render: (r) => r.spvName },
                { key: "spvEmployeeId", label: "SPV Employee ID", render: (r) => findEmployee(r.spvName)?.employeeId },
                { key: "spvDepartemen", label: "SPV Departemen", render: (r) => findEmployee(r.spvName)?.departemen },
                { key: "leaderName", label: "Leader", render: (r) => r.leaderName },
                { key: "leaderEmployeeId", label: "Leader Employee ID", render: (r) => findEmployee(r.leaderName)?.employeeId },
                { key: "leaderDepartemen", label: "Leader Departemen", render: (r) => findEmployee(r.leaderName)?.departemen },
                {
                  key: "members",
                  label: "Member",
                  render: (r) => {
                    const members = r.members ?? [];
                    const list = members.map((m) => {
                      const emp = findEmployee(m);
                      return emp ? `${m} (${emp.employeeId} · ${emp.departemen ?? "-"})` : m;
                    });
                    return [String(members.length), ...list].join(" | ");
                  },
                },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
                { key: "typesOfProducts", label: "Types of Products", render: (r) => r.typesOfProducts },
                { key: "baseColor", label: "Base Color", render: (r) => r.baseColor },
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
                { key: "formPerMan", label: "Form/Man", render: (r) => r.formPerMan },
                { key: "remark", label: "Remark", render: (r) => r.remark },
                { key: "inputBy", label: "Input By", render: (r) => r.inputBy },
                { key: "attachments", label: "Lampiran", render: (r) => (r.attachments.length ? `${r.attachments.length} file` : "-") },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                        ✏️
                      </button>
                      {user?.access === "FULL_ACCESS" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data Colour Matching untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
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
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO yang sudah "Aftermix - DN" dan sedang menunggu dikerjakan Colour Matching -- diurutkan Finish
              Aftermix paling awal duluan (FIFO). PWO otomatis hilang dari daftar ini begitu sudah ada input Colour
              Matching utk PWO tersebut, atau begitu PWO itu sudah masuk tahap setelah Colour Matching (Approval,
              Packing).
            </p>
            <input
              placeholder="Cari nomor Order..."
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: QueueRow) => r.order}
              exportFileName="colour-matching-pwo-schedule-queue"
              storageKey="colour-matching-pwo-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki (Aftermix)", render: (r) => r.codeTanki },
                { key: "spvProduksi", label: "SPV Produksi (Aftermix)", render: (r) => r.spvProduksi },
                { key: "leader", label: "Leader (Aftermix)", render: (r) => r.leader },
                {
                  key: "members",
                  label: "Member (Aftermix)",
                  render: (r) => (r.members ?? []).join(", "),
                },
                { key: "qtyPerMan", label: "Qty/Man (Liter) (Aftermix)", render: (r) => r.qtyPerMan },
                {
                  key: "start",
                  label: "Start Aftermix",
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish Aftermix",
                  render: (r) => formatDateTime(r.finish),
                  csvValue: (r) => toExcelDateTimeString(r.finish),
                },
                { key: "remark", label: "Remark (Aftermix)", render: (r) => r.remark },
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
                      Input Colour Matching
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
