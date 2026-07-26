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
  qtyAct: 160,
  formReceived: 190,
  start: 190,
  finish: 190,
  member: 180,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah.
 * Layout direvisi 2026-07-26 sesuai mockup eksplisit user (baris Order/Material/
 * Batch/Qty/Plant digabung jadi 1 baris, Form Received/Start/Finish jadi baris
 * tersendiri sebelum SPV/Leader/Qty Act). */
const MILLING_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription", "batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki1", "codeTanki2", "codeMesin"],
  ["formReceived", "start", "finish"],
  ["spvProduksi", "leader", "qtyAct"],
  ["member"],
];

const READING_SLOTS = 10;
const emptyReadings = () => Array(READING_SLOTS).fill("");

interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string;
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
  start: string | null;
  finish: string | null;
  spvProduksi: string;
  leader: string | null;
  qtyAct: string | null;
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
  qtyAct: "",
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
    MILLING_COL_DEFAULT_WIDTHS,
    "millingColWidths",
    MILLING_COL_ROWS
  );

  const historyQuery = useQuery({
    queryKey: ["milling-history"],
    queryFn: () => api.get<{ success: boolean; data: LogRow[] }>("/milling/history").then((r) => r.data),
  });

  const queueQuery = useQuery({
    queryKey: ["milling-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/milling/pwo-queue").then((r) => r.data),
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
        setForm((f) => ({ ...f, iuPlant: res.data!.iuPlant || f.iuPlant }));
      }
    } catch {
      /* saran IU Plant bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
    // Code Tanki 2 (Moving) SENGAJA diambil dari Code Tanki proses Premix
    // (bukan dari histori Milling sendiri) -- Code Tanki 1 (Couple) & Code
    // Mesin tetap diisi manual oleh SPV area Milling, sesuai instruksi
    // eksplisit user (2026-07-26).
    try {
      const premixRes = await api.get<{ success: boolean; data: { codeTanki: string } | null }>(
        `/premix-aftermix/latest-by-order/${encodeURIComponent(data.order)}?section=PREMIX`
      );
      if (premixRes.data) {
        setForm((f) => ({ ...f, codeTanki2: premixRes.data!.codeTanki || f.codeTanki2 }));
      }
    } catch {
      /* belum ada data Premix utk Order ini -- biarkan Code Tanki 2 kosong, diisi manual */
    }
    // Kolom lain (SPV Produksi, Leader, Member, Code Tanki 1, Code Mesin,
    // Start, Finish, Fineness/Visco/Suhu, Remark) diambil dari input TERAKHIR
    // (mesin manapun) untuk Order ini di Milling. Asumsi default: user
    // melanjutkan/mengedit mesin yg SAMA dgn histori paling akhir -- kalau
    // user lalu mengganti Code Mesin secara manual, lihat checkMachineRecord
    // di bawah (dipanggil saat blur) yg akan cek ulang apakah itu mesin yg
    // sudah pernah diinput (edit) atau mesin BARU (1 Order running di >1
    // mesin sekaligus -- entri baru, bukan menimpa), sesuai instruksi
    // eksplisit user (2026-07-26).
    try {
      const latestRes = await api.get<{ success: boolean; data: LogRow | null }>(
        `/milling/latest-by-order/${encodeURIComponent(data.order)}`
      );
      const latest = latestRes.data;
      if (latest) {
        setEditingId(latest.id);
        setForm((f) => ({
          ...f,
          spvProduksi: f.spvProduksi || latest.spvProduksi || "",
          leader: f.leader || latest.leader || "",
          qtyAct: f.qtyAct || latest.qtyAct || "",
          members: f.members.length > 0 ? f.members : latest.members ?? [],
          codeTanki1: f.codeTanki1 || latest.codeTanki1 || "",
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

  /** Dipanggil saat user selesai mengetik/mengganti Code Mesin (blur) -- cek
   * ulang apakah kombinasi Order + Code Mesin ini SUDAH pernah diinput
   * sebelumnya (berarti sedang mengedit record mesin itu) atau BELUM (berarti
   * Order ini sedang running di mesin lain scr bersamaan -- harus jadi entri
   * BARU, bukan menimpa record mesin sebelumnya), sesuai instruksi eksplisit
   * user (2026-07-26). */
  async function checkMachineRecord() {
    const order = form.order.trim();
    const codeMesin = form.codeMesin.trim();
    if (!order || !codeMesin) return;
    try {
      const res = await api.get<{ success: boolean; data: LogRow | null }>(
        `/milling/latest-by-order/${encodeURIComponent(order)}?codeMesin=${encodeURIComponent(codeMesin)}`
      );
      const match = res.data;
      if (match) {
        setEditingId(match.id);
        setForm((f) => ({
          ...f,
          spvProduksi: match.spvProduksi || f.spvProduksi,
          leader: match.leader ?? f.leader,
          qtyAct: match.qtyAct ?? f.qtyAct,
          members: match.members ?? f.members,
          codeTanki1: match.codeTanki1 ?? f.codeTanki1,
          formReceived: match.formReceived ?? f.formReceived,
          start: match.start ?? f.start,
          finish: match.finish ?? f.finish,
          fineness: match.fineness ? padReadings(match.fineness) : f.fineness,
          visco: match.visco ? padReadings(match.visco) : f.visco,
          suhu: match.suhu ? padReadings(match.suhu) : f.suhu,
          remark: match.remark ?? f.remark,
        }));
      } else {
        // Kombinasi Order + Code Mesin ini belum pernah ada -- entri BARU
        // (POST) begitu Save, BUKAN menimpa record mesin lain utk Order yg sama.
        setEditingId(null);
      }
    } catch {
      /* biarkan state form apa adanya kalau lookup gagal */
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
      start: row.start ?? "",
      finish: row.finish ?? "",
      spvProduksi: row.spvProduksi,
      leader: row.leader ?? "",
      qtyAct: row.qtyAct ?? "",
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

  /** Isi Order dari PWO Schedule & Queue ke form Input Milling (lewat alur
   * handleOrderFound yg sama dgn ketik manual di OrderLookup), supaya Order
   * qty/Material/Plant/IU Plant/Code Tanki tersaran otomatis begitu tim
   * Milling mengambil PWO ini dari antrian. */
  function loadIntoInput(row: QueueRow) {
    setForm((f) => ({ ...f, order: row.order }));
    handleOrderFound({
      order: row.order,
      batch: row.batch,
      materialNumber: row.materialNumber,
      materialDescription: row.materialDescription,
      orderQty: row.orderQty,
      plant: row.plant,
      // Milling tidak punya kolom Types of Products/Base Color/Volume --
      // 3 field ini cuma dipakai Colour Matching & Packing, jadi null di sini tidak berpengaruh.
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
          Input Milling
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
                  <input value={form.codeMesin} onChange={(e) => setForm({ ...form, codeMesin: e.target.value })} onBlur={checkMachineRecord} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
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
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvProduksi} onResizeStart={beginResize("spvProduksi")}>
                  <EmployeeNameSelect bare id="milling-spv" value={form.spvProduksi} onChange={(v) => setForm({ ...form, spvProduksi: v })} required />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leader} onResizeStart={beginResize("leader")}>
                  <EmployeeNameSelect bare id="milling-leader" value={form.leader} onChange={(v) => setForm({ ...form, leader: v })} />
                </ExcelField>
                <ExcelField label="Qty Act" color="orange" widthPx={colWidths.qtyAct} onResizeStart={beginResize("qtyAct")}>
                  <input value={form.qtyAct} onChange={(e) => setForm({ ...form, qtyAct: e.target.value })} />
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
                { key: "qtyAct", label: "Qty Act", render: (r) => r.qtyAct },
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
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish",
                  render: (r) => (r.finish ? formatDateTime(r.finish) : ""),
                  csvValue: (r) => (r.finish ? toExcelDateTimeString(r.finish) : ""),
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

      {tab === "queue" && (
        <div className="panel">
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO yang sudah Finish Premix dan sedang menunggu dikerjakan Milling -- diurutkan Finish Premix paling
              awal duluan (FIFO). PWO otomatis hilang dari daftar ini begitu sudah ada input Milling utk PWO
              tersebut, atau begitu PWO itu sudah masuk tahap setelah Milling (Aftermix, Colour Matching, Approval,
              Packing) -- yg berarti Premix-nya sudah pasti selesai walau input Milling-nya sendiri tidak tercatat.
            </p>
            <input
              placeholder="Cari nomor Order..."
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: QueueRow) => r.order}
              exportFileName="pwo-schedule-queue"
              storageKey="milling-pwo-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki (Premix)", render: (r) => r.codeTanki },
                { key: "spvProduksi", label: "SPV Produksi (Premix)", render: (r) => r.spvProduksi },
                { key: "leader", label: "Leader (Premix)", render: (r) => r.leader },
                {
                  key: "members",
                  label: "Member (Premix)",
                  render: (r) => (r.members ?? []).join(", "),
                },
                { key: "qtyPerMan", label: "Qty/Man (Liter)", render: (r) => r.qtyPerMan },
                {
                  key: "start",
                  label: "Start Premix",
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish Premix",
                  render: (r) => formatDateTime(r.finish),
                  csvValue: (r) => toExcelDateTimeString(r.finish),
                },
                { key: "remark", label: "Remark (Premix)", render: (r) => r.remark },
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
                      Input Milling
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
