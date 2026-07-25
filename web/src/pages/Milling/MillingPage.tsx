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
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). */
const MILLING_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 220,
  materialNumber: 200,
  materialDescription: 260,
  batch: 160,
  orderQty: 140,
  plant: 120,
  iuPlant: 160,
  codeTanki1: 170,
  codeTanki2: 170,
  codeMesin: 150,
  spvProduksi: 170,
  leader: 170,
  formReceived: 190,
  start: 190,
  finish: 190,
  member: 180,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const MILLING_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription"],
  ["batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki1", "codeTanki2", "codeMesin"],
  ["spvProduksi", "leader", "formReceived", "start", "finish"],
  ["member"],
];

const READING_SLOTS = 10;
const emptyReadings = () => Array(READING_SLOTS).fill("");

interface LogRow {
  id: number;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string;
  codeTanki1: string | null;
  codeTanki2: string | null;
  codeMesin: string | null;
  formReceived: string | null;
  start: string;
  finish: string;
  spvProduksi: string;
  leader: string | null;
  members: string[] | null;
  fineness: string[] | null;
  visco: string[] | null;
  suhu: string[] | null;
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
  codeTanki1: "",
  codeTanki2: "",
  codeMesin: "",
  formReceived: "",
  start: "",
  finish: "",
  spvProduksi: "",
  leader: "",
  members: [] as string[],
  fineness: emptyReadings(),
  visco: emptyReadings(),
  suhu: emptyReadings(),
  remark: "",
};

const GRID_BORDER = "1px solid #cbd5e1";

function ReadingGrid({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (idx: number, value: string) => void;
}) {
  return (
    <div className="excel-block" style={{ marginTop: 8, border: GRID_BORDER }}>
      <div className="excel-section-title">{label}</div>
      <div className="excel-row">
        {values.map((v, idx) => (
          <input
            key={idx}
            value={v}
            onChange={(e) => onChange(idx, e.target.value)}
            style={{
              flex: 1,
              minWidth: 40,
              textAlign: "center",
              border: GRID_BORDER,
              borderTop: "none",
              padding: "6px 4px",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function MillingPage() {
  const { user } = useAuth();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history">("input");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    MILLING_COL_DEFAULT_WIDTHS,
    "millingColWidths",
    MILLING_COL_ROWS
  );

  const historyQuery = useQuery({
    queryKey: ["milling-history"],
    queryFn: () => api.get<{ success: boolean; data: LogRow[] }>("/milling/history").then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? api.put<{ success: boolean; data: LogRow }>(`/milling/${editingId}`, form)
        : api.post<{ success: boolean; data: LogRow }>("/milling", form),
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["milling-history"] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data Milling berhasil diperbarui." : "Data Milling berhasil disimpan.");
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/milling/${id}`),
    onSuccess: () => {
      setMessage("Data Milling berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["milling-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/milling/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["milling-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      batch: data.batch ?? "",
      orderQty: data.orderQty ?? "",
      plant: data.plant ?? "",
    }));
    try {
      const res = await api.get<{ success: boolean; data: { iuPlant: string; codeTanki: string } | null }>(
        `/master-data/order-context/${encodeURIComponent(data.order)}`
      );
      if (res.data) {
        setForm((f) => ({
          ...f,
          iuPlant: res.data!.iuPlant || f.iuPlant,
          codeTanki1: res.data!.codeTanki || f.codeTanki1,
        }));
      }
    } catch {
      /* saran IU Plant/Code Tanki bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
    // Kolom lain (SPV Produksi, Leader, Member, Code Tanki 2, Code Mesin, Start,
    // Finish, Fineness/Visco/Suhu, Remark) diambil dari input TERAKHIR untuk
    // Order ini di Milling (bukan lintas modul).
    try {
      const latestRes = await api.get<{ success: boolean; data: LogRow | null }>(
        `/milling/latest-by-order/${encodeURIComponent(data.order)}`
      );
      const latest = latestRes.data;
      if (latest) {
        // Order ini sudah pernah diinput -- masuk mode Edit record yang sama
        // (bukan bikin baris baru) supaya History tetap 1 baris per Order:
        // data baru akan menimpa/replace data lama saat Save.
        setEditingId(latest.id);
        setForm((f) => ({
          ...f,
          spvProduksi: f.spvProduksi || latest.spvProduksi || "",
          leader: f.leader || latest.leader || "",
          members: f.members.length > 0 ? f.members : latest.members ?? [],
          codeTanki2: f.codeTanki2 || latest.codeTanki2 || "",
          codeMesin: f.codeMesin || latest.codeMesin || "",
          formReceived: f.formReceived || latest.formReceived || "",
          start: f.start || latest.start || "",
          finish: f.finish || latest.finish || "",
          fineness: f.fineness.some(Boolean) ? f.fineness : padReadings(latest.fineness),
          visco: f.visco.some(Boolean) ? f.visco : padReadings(latest.visco),
          suhu: f.suhu.some(Boolean) ? f.suhu : padReadings(latest.suhu),
          remark: f.remark || latest.remark || "",
        }));
      } else {
        setEditingId(null);
      }
    } catch {
      /* belum ada input sebelumnya untuk Order ini -- biarkan kosong */
    }
  }

  function addMember() {
    const name = memberInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    setError("");
    setForm((f) => ({ ...f, members: [...f.members, name] }));
    setMemberInput("");
  }

  function removeLastMember() {
    setForm((f) => ({ ...f, members: f.members.slice(0, -1) }));
  }

  function updateReading(field: "fineness" | "visco" | "suhu", idx: number, value: string) {
    setForm((f) => ({ ...f, [field]: f[field].map((v, i) => (i === idx ? value : v)) }));
  }

  function padReadings(values: string[] | null): string[] {
    const arr = values ?? [];
    return Array.from({ length: READING_SLOTS }, (_, i) => arr[i] ?? "");
  }

  function startEdit(row: LogRow) {
    setEditingId(row.id);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch,
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant,
      codeTanki1: row.codeTanki1 ?? "",
      codeTanki2: row.codeTanki2 ?? "",
      codeMesin: row.codeMesin ?? "",
      formReceived: row.formReceived ?? "",
      start: row.start,
      finish: row.finish,
      spvProduksi: row.spvProduksi,
      leader: row.leader ?? "",
      members: row.members ?? [],
      fineness: padReadings(row.fineness),
      visco: padReadings(row.visco),
      suhu: padReadings(row.suhu),
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
    if (!isKnownEmployeeName(employees, form.spvProduksi)) {
      setError("SPV Produksi tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownEmployeeName(employees, form.leader)) {
      setError("Leader tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    saveMutation.mutate();
  }

  const filteredHistory = (historyQuery.data ?? []).filter((row) =>
    search.trim() ? row.order.toLowerCase().includes(search.trim().toLowerCase()) : true
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
          Input Milling
        </button>
        <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
          History
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
            <ExcelBlock title="Production & MRP Schedule » Milling, Input Proses">
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
                  <input value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} />
                </ExcelField>
                <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")}>
                  <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={colWidths.iuPlant} onResizeStart={beginResize("iuPlant")}>
                  <IuPlantSelect bare id="milling-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} required />
                </ExcelField>
                <ExcelField label="Code Tanki 1 (Couple)" widthPx={colWidths.codeTanki1} onResizeStart={beginResize("codeTanki1")}>
                  <TankSelect bare id="milling-tank-1" value={form.codeTanki1} onChange={(v) => setForm({ ...form, codeTanki1: v })} required={false} />
                </ExcelField>
                <ExcelField label="Code Tanki 2 (Moving)" widthPx={colWidths.codeTanki2} onResizeStart={beginResize("codeTanki2")}>
                  <TankSelect bare id="milling-tank-2" value={form.codeTanki2} onChange={(v) => setForm({ ...form, codeTanki2: v })} required={false} />
                </ExcelField>
                <ExcelField label="Code Mesin" widthPx={colWidths.codeMesin} onResizeStart={beginResize("codeMesin")}>
                  <input value={form.codeMesin} onChange={(e) => setForm({ ...form, codeMesin: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvProduksi} onResizeStart={beginResize("spvProduksi")}>
                  <EmployeeNameSelect bare id="milling-spv" value={form.spvProduksi} onChange={(v) => setForm({ ...form, spvProduksi: v })} required />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leader} onResizeStart={beginResize("leader")}>
                  <EmployeeNameSelect bare id="milling-leader" value={form.leader} onChange={(v) => setForm({ ...form, leader: v })} />
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
                    required
                  />
                </ExcelField>
                <ExcelField label="Finish" widthPx={colWidths.finish} onResizeStart={beginResize("finish")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.finish)}
                    onChange={(e) => setForm({ ...form, finish: e.target.value })}
                    required
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Member" widthPx={colWidths.member} onResizeStart={beginResize("member")}>
                  <EmployeeNameSelect bare id="milling-member" value={memberInput} onChange={setMemberInput} placeholder="Nama anggota" />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <div className="excel-cell" style={{ flexBasis: "15%", maxWidth: "15%", flexDirection: "row", gap: 4, padding: 4 }}>
                  <button type="button" className="btn btn-info" style={{ flex: 1 }} onClick={addMember}>
                    + Add
                  </button>
                  <button type="button" className="btn btn-danger" style={{ flex: 1 }} onClick={removeLastMember} disabled={form.members.length === 0}>
                    − Reduce
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

            <ReadingGrid label="Fineness" values={form.fineness} onChange={(idx, v) => updateReading("fineness", idx, v)} />
            <ReadingGrid label="Visco" values={form.visco} onChange={(idx, v) => updateReading("visco", idx, v)} />
            <ReadingGrid label="Suhu" values={form.suhu} onChange={(idx, v) => updateReading("suhu", idx, v)} />

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
          <div className="panel-header">History Milling</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: LogRow) => r.id}
              exportFileName="history-milling"
              storageKey="milling-history"
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
                { key: "spvProduksi", label: "SPV Produksi", render: (r) => r.spvProduksi },
                { key: "spvEmployeeId", label: "SPV Employee ID", render: (r) => findEmployee(r.spvProduksi)?.employeeId },
                { key: "spvDepartemen", label: "SPV Departemen", render: (r) => findEmployee(r.spvProduksi)?.departemen },
                { key: "leader", label: "Leader", render: (r) => r.leader },
                { key: "leaderEmployeeId", label: "Leader Employee ID", render: (r) => findEmployee(r.leader)?.employeeId },
                { key: "leaderDepartemen", label: "Leader Departemen", render: (r) => findEmployee(r.leader)?.departemen },
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
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeMesin", label: "Code Mesin", render: (r) => r.codeMesin },
                { key: "codeTanki1", label: "Code Tanki 1 (Couple)", render: (r) => r.codeTanki1 },
                { key: "codeTanki2", label: "Code Tanki 2 (Moving)", render: (r) => r.codeTanki2 },
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
                { key: "fineness", label: "Fineness", render: (r) => (r.fineness ?? []).join(", ") },
                { key: "visco", label: "Visco", render: (r) => (r.visco ?? []).join(", ") },
                { key: "suhu", label: "Suhu", render: (r) => (r.suhu ?? []).join(", ") },
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
                            if (confirm(`Hapus data Milling untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
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
    </div>
  );
}
