import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import EmployeeNameSelect, { isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import DataTable from "../../components/DataTable";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { computeQtyPerMan } from "../../lib/qty";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). */
const PREMIX_AFTERMIX_COL_DEFAULT_WIDTHS: Record<string, number> = {
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
  spvProduksi: 180,
  leader: 180,
  qtyPerMan: 160,
  member: 180,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const PREMIX_AFTERMIX_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription"],
  ["batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki", "formReceived", "start", "finish"],
  ["spvProduksi", "leader", "qtyPerMan"],
  ["member"],
];

type Section = "PREMIX" | "AFTERMIX";

/** Baris antrian "PWO Schedule & Queue" -- khusus AFTERMIX, sumbernya History
 * Milling (bukan History Aftermix sendiri), lihat GET /premix-aftermix/aftermix-pwo-queue. */
interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string;
  codeTanki1: string | null;
  codeTanki2: string | null;
  codeMesin: string | null;
  spvProduksi: string;
  leader: string | null;
  members: string[] | null;
  qtyAct: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string;
  remark: string | null;
}

/** Baris antrian "PWO Schedule & Queue" -- khusus PREMIX, sumbernya Master
 * Data Cooispi (Referensi Order/PO SAP-COOISPI), BUKAN History tahap
 * sebelumnya (Premix tahap pertama, tidak punya tahap sebelumnya) -- lihat
 * GET /premix-aftermix/premix-pwo-queue (2026-07-29). Cuma field referensi
 * dasar (belum ada data crew/tanki/tanggal krn belum pernah diproses sama
 * sekali). */
interface PremixQueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  /** Terisi kalau Order ini sudah py baris Premix Form-Received-only (Start
   * belum diisi) -- Order itu TETAP di antrian ini sampai Start terisi,
   * lihat GET /premix-aftermix/premix-pwo-queue (direvisi 2026-07-30). */
  formReceived: string | null;
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
  iuPlant: string | null;
  spvProduksi: string;
  members: string[] | null;
  qtyPerMan: string | null;
  start: string | null;
  leader: string | null;
  finish: string | null;
  codeTanki: string;
  formReceived: string | null;
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
  spvProduksi: "",
  members: [] as string[],
  qtyPerMan: "",
  start: "",
  leader: "",
  finish: "",
  codeTanki: "",
  formReceived: "",
  remark: "",
};

export default function PremixAftermixPage({
  section,
  title,
  embedded = false,
  initialOrder,
  onSaved,
}: {
  section: Section;
  title: string;
  /** Mode ringkas dipakai pop-up "Tahap Selanjutnya" di Production Order
   * Monitoring (2026-07-31, instruksi eksplisit user) -- sembunyikan
   * tab-switcher History/PWO Queue, cuma tampilkan form Input. Halaman biasa
   * (/planning/premix, /planning/aftermix) TIDAK pakai prop ini sama sekali,
   * jadi perilakunya tidak berubah. */
  embedded?: boolean;
  /** Order yg langsung di-lookup otomatis begitu komponen ini mount --
   * dipakai bareng `embedded`, meniru persis apa yg terjadi kalau user
   * ngetik Order lalu Enter/blur di OrderLookup biasa. */
  initialOrder?: string;
  /** Dipanggil SETELAH save sukses (di luar behavior normal spt setMessage) --
   * dipakai pop-up utk nutup diri sendiri & refresh Dashboard. */
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const isViewOnly = getMenuLevel(user, section === "PREMIX" ? "premix" : "aftermix") === "VIEW";
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history" | "queue">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memberNameInput, setMemberNameInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    PREMIX_AFTERMIX_COL_DEFAULT_WIDTHS,
    `premixAftermixColWidths-${section}`,
    PREMIX_AFTERMIX_COL_ROWS
  );

  const historyQuery = useQuery({
    queryKey: ["premix-aftermix-history", section],
    queryFn: () =>
      api.get<{ success: boolean; data: LogRow[] }>(`/premix-aftermix/history?section=${section}`).then((r) => r.data),
    // Mode "embedded" (pop-up "Tahap Selanjutnya", 2026-07-31) cuma
    // nampilin form Input, History/Queue tidak pernah dirender -- jadi tidak
    // perlu ikut fetch percuma di background.
    enabled: !embedded,
  });

  // Antrian "PWO Schedule & Queue" AFTERMIX (sumbernya History Milling) --
  // sengaja `enabled: section === "AFTERMIX"` supaya halaman Premix tidak
  // ikut fetch endpoint ini percuma.
  const queueQuery = useQuery({
    queryKey: ["aftermix-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/premix-aftermix/aftermix-pwo-queue").then((r) => r.data),
    enabled: !embedded && section === "AFTERMIX",
  });

  // Antrian "PWO Schedule & Queue" PREMIX (sumbernya Master Data Cooispi,
  // BUKAN History tahap sebelumnya -- Premix tahap pertama), lihat GET
  // /premix-aftermix/premix-pwo-queue (2026-07-29). `enabled: section ===
  // "PREMIX"` supaya halaman Aftermix tidak ikut fetch endpoint ini percuma.
  const premixQueueQuery = useQuery({
    queryKey: ["premix-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: PremixQueueRow[] }>("/premix-aftermix/premix-pwo-queue").then((r) => r.data),
    enabled: !embedded && section === "PREMIX",
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { section, ...form };
      return editingId
        ? api.put<{ success: boolean; data: LogRow }>(`/premix-aftermix/${editingId}`, payload)
        : api.post<{ success: boolean; data: LogRow }>("/premix-aftermix", payload);
    },
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["premix-aftermix-history", section] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data berhasil diperbarui." : "Data berhasil disimpan.");
      }
      onSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/premix-aftermix/${id}`),
    onSuccess: () => {
      setMessage("Data berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["premix-aftermix-history", section] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/premix-aftermix/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["premix-aftermix-history", section] });
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
        qtyPerMan: computeQtyPerMan(orderQty, f.members.length),
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
    // dari input TERAKHIR untuk Order ini DI MODUL YANG SAMA (bukan lintas
    // modul) -- Remark SENGAJA tidak ikut disarankan dari order-context lintas
    // modul di atas, supaya tiap proses punya Remark sendiri-sendiri.
    try {
      const latestRes = await api.get<{ success: boolean; data: LogRow | null }>(
        `/premix-aftermix/latest-by-order/${encodeURIComponent(data.order)}?section=${section}`
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
            spvProduksi: f.spvProduksi || latest.spvProduksi || "",
            leader: f.leader || latest.leader || "",
            members,
            start: f.start || latest.start || "",
            finish: f.finish || latest.finish || "",
            formReceived: f.formReceived || latest.formReceived || "",
            remark: f.remark || latest.remark || "",
            qtyPerMan: computeQtyPerMan(f.orderQty, members.length),
          };
        });
      } else {
        setEditingId(null);
      }
    } catch {
      /* belum ada input sebelumnya untuk Order ini -- biarkan kosong */
    }
  }

  // Mode pop-up "Tahap Selanjutnya" (embedded+initialOrder) -- meniru PERSIS
  // apa yg terjadi kalau user ngetik Order lalu Enter/blur di OrderLookup
  // biasa, supaya tidak perlu ngetik ulang Order-nya.
  useEffect(() => {
    if (!embedded || !initialOrder) return;
    setForm((f) => ({ ...f, order: initialOrder }));
    api
      .get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(initialOrder)}`)
      .then((res) => handleOrderFound(res.data))
      .catch(() => {
        /* Order tidak ditemukan di Master Data -- biarkan kosong, user isi manual */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialOrder]);

  function handleOrderQtyChange(orderQty: string) {
    setForm((f) => ({ ...f, orderQty, qtyPerMan: computeQtyPerMan(orderQty, f.members.length) }));
  }

  function addMember() {
    const name = memberNameInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    setError("");
    setForm((f) => {
      const members = [...f.members, name];
      return { ...f, members, qtyPerMan: computeQtyPerMan(f.orderQty, members.length) };
    });
    setMemberNameInput("");
  }

  function removeLastMember() {
    setForm((f) => {
      const members = f.members.slice(0, -1);
      return { ...f, members, qtyPerMan: computeQtyPerMan(f.orderQty, members.length) };
    });
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
      iuPlant: row.iuPlant ?? "",
      spvProduksi: row.spvProduksi,
      members: row.members ?? [],
      qtyPerMan: row.qtyPerMan ?? "",
      start: row.start ?? "",
      leader: row.leader ?? "",
      finish: row.finish ?? "",
      codeTanki: row.codeTanki,
      formReceived: row.formReceived ?? "",
      remark: row.remark ?? "",
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  /** Isi Order dari PWO Schedule & Queue ke form Input Premix/Aftermix (lewat
   * alur handleOrderFound yg sama dgn ketik manual di OrderLookup) -- sama
   * pola dgn loadIntoInput di MillingPage.tsx. Parameter-nya SENGAJA dibuat
   * minimal (bukan QueueRow penuh) supaya bisa dipakai bareng utk baris
   * antrian Premix (PremixQueueRow, field-nya lebih sedikit) maupun Aftermix. */
  function loadIntoInput(row: {
    order: string;
    batch: string | null;
    materialNumber: string | null;
    materialDescription: string | null;
    orderQty: string | null;
    plant: string | null;
  }) {
    setForm((f) => ({ ...f, order: row.order }));
    handleOrderFound({
      order: row.order,
      batch: row.batch,
      materialNumber: row.materialNumber,
      materialDescription: row.materialDescription,
      orderQty: row.orderQty,
      plant: row.plant,
      // Premix/Aftermix tidak punya kolom Types of Products/Base Color/Volume
      // -- 3 field ini cuma dipakai Colour Matching & Packing.
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

  const filteredPremixQueue = (premixQueueQuery.data ?? []).filter((row) =>
    queueSearch.trim() ? row.order.toLowerCase().includes(queueSearch.trim().toLowerCase()) : true
  );

  function findEmployee(name: string | null) {
    const trimmed = (name ?? "").trim().toLowerCase();
    if (!trimmed) return undefined;
    return (employees ?? []).find((e) => e.fullName.trim().toLowerCase() === trimmed);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          {!isViewOnly && (
            <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
              Input {title}
            </button>
          )}
          <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
            History
          </button>
          <button className={`btn ${tab === "queue" ? "" : "btn-outline"}`} onClick={() => setTab("queue")}>
            PWO Schedule &amp; Queue
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
            <ExcelBlock title={`Production & MRP Schedule » ${title}, Input Proses`}>
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
                  <IuPlantSelect bare id={`${section}-iu-plant`} value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} required />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")}>
                  <TankSelect bare id={`${section}-tank`} value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
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
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvProduksi} onResizeStart={beginResize("spvProduksi")}>
                  <EmployeeNameSelect bare id={`${section}-spv`} value={form.spvProduksi} onChange={(v) => setForm({ ...form, spvProduksi: v })} required />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leader} onResizeStart={beginResize("leader")}>
                  <EmployeeNameSelect bare id={`${section}-leader`} value={form.leader} onChange={(v) => setForm({ ...form, leader: v })} />
                </ExcelField>
                <ExcelField label="Qty/Man (Liter)" color="orange" widthPx={colWidths.qtyPerMan} onResizeStart={beginResize("qtyPerMan")}>
                  <input
                    value={form.qtyPerMan}
                    onChange={(e) => setForm({ ...form, qtyPerMan: e.target.value })}
                    title="Otomatis: Order Qty ÷ jumlah Member -- bisa diubah manual bila perlu"
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Member" widthPx={colWidths.member} onResizeStart={beginResize("member")}>
                  <EmployeeNameSelect bare id={`${section}-member`} value={memberNameInput} onChange={setMemberNameInput} placeholder="Nama anggota" />
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
          <div className="panel-header">History {title}</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: LogRow) => r.id}
              exportFileName={`history-${section.toLowerCase()}`}
              storageKey={`premix-aftermix-history-${section.toLowerCase()}`}
              rows={filteredHistory}
              columns={[
                {
                  key: "timestamp",
                  label: "Timestamp",
                  render: (r) => formatDateTime(r.timestamp),
                  csvValue: (r) => toExcelDateTimeString(r.timestamp),
                },
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "spvProduksi", label: "SPV Produksi", render: (r) => r.spvProduksi },
                { key: "spvEmployeeId", label: "SPV Employee ID", render: (r) => findEmployee(r.spvProduksi)?.employeeId },
                { key: "leader", label: "Leader", render: (r) => r.leader },
                { key: "leaderEmployeeId", label: "Leader Employee ID", render: (r) => findEmployee(r.leader)?.employeeId },
                {
                  key: "members",
                  label: "Member",
                  render: (r) => {
                    const members = r.members ?? [];
                    const list = members.map((m) => {
                      const emp = findEmployee(m);
                      return emp ? `${m} (${emp.employeeId})` : m;
                    });
                    return [String(members.length), ...list].join(" | ");
                  },
                },
                { key: "qtyPerMan", label: "Qty/Man (Liter)", render: (r) => r.qtyPerMan },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
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
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish",
                  render: (r) => (r.finish ? formatDateTime(r.finish) : ""),
                  csvValue: (r) => (r.finish ? toExcelDateTimeString(r.finish) : ""),
                },
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
                            if (confirm(`Hapus data ${title} untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
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

      {tab === "queue" && section === "AFTERMIX" && (
        <div className="panel">
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO yang sudah "Milling - DN" dan sedang menunggu dikerjakan Aftermix -- diurutkan Finish Milling
              paling awal duluan (FIFO). PWO otomatis hilang dari daftar ini begitu sudah ada input Aftermix utk
              PWO tersebut, atau begitu PWO itu sudah masuk tahap setelah Aftermix (Colour Matching, Approval,
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
              exportFileName="aftermix-pwo-schedule-queue"
              storageKey="aftermix-pwo-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki1", label: "Code Tanki 1 (Couple)", render: (r) => r.codeTanki1 },
                { key: "codeTanki2", label: "Code Tanki 2 (Moving)", render: (r) => r.codeTanki2 },
                { key: "codeMesin", label: "Code Mesin", render: (r) => r.codeMesin },
                { key: "spvProduksi", label: "SPV Produksi (Milling)", render: (r) => r.spvProduksi },
                { key: "leader", label: "Leader (Milling)", render: (r) => r.leader },
                {
                  key: "members",
                  label: "Member (Milling)",
                  render: (r) => (r.members ?? []).join(", "),
                },
                { key: "qtyAct", label: "Qty Act (Milling)", render: (r) => r.qtyAct },
                {
                  key: "start",
                  label: "Start Milling",
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish Milling",
                  render: (r) => formatDateTime(r.finish),
                  csvValue: (r) => toExcelDateTimeString(r.finish),
                },
                { key: "remark", label: "Remark (Milling)", render: (r) => r.remark },
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
                      Input Aftermix
                    </button>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          </div>
        </div>
      )}

      {tab === "queue" && section === "PREMIX" && (
        <div className="panel">
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO dari Master Data Cooispi yang Material Number-nya pernah punya histori Premix, dan Start Premix-nya
              belum diisi (termasuk yang baru Form Received) -- diurutkan sesuai urutan Master Data Cooispi. PWO
              otomatis hilang dari daftar ini begitu Start Premix-nya sudah diisi, atau begitu PWO itu sudah masuk
              tahap setelah Premix (Milling, Aftermix, Colour Matching, Approval, Packing). Material Number yang
              memang tidak pernah lewat Premix (bukan bagian rangkaian proses material itu) tidak ikut ditampilkan di
              sini.
            </p>
            <input
              placeholder="Cari nomor Order..."
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: PremixQueueRow) => r.order}
              exportFileName="premix-pwo-schedule-queue"
              storageKey="premix-pwo-queue"
              rows={filteredPremixQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                {
                  key: "formReceived",
                  label: "Form Received",
                  render: (r) => (r.formReceived ? formatDateTime(r.formReceived) : "-"),
                  csvValue: (r) => (r.formReceived ? toExcelDateTimeString(r.formReceived) : ""),
                },
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
                      Input Premix
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
