import { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect from "../../components/TankSelect";
import EmployeeNameSelect, { formatInputBy, isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import DataTable from "../../components/DataTable";
import AutoGrowTextarea from "../../components/AutoGrowTextarea";
import { ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { evaluateSpec, SPEC_VERDICT_COLOR, SPEC_VERDICT_LABEL } from "../../lib/specEval";
import { openCheckSheetPrintWindow } from "../../lib/printCheckSheet";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

interface ParamRow {
  no: number;
  parameter: string;
  standard: string;
  result: string;
  remark: string;
  start: string;
  finish: string;
  pic: string;
}

interface AppearanceFile {
  id: number;
  fileName: string;
  filePath: string;
}

interface CheckRow {
  checkId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  customer: string | null;
  custSegmen: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  lotCoa: string | null;
  codeTanki: string | null;
  remark: string | null;
  appearanceNotes: string | null;
  information: string | null;
  checkNotes: string | null;
  inputBy: string;
  parameters: ParamRow[];
  appearanceFiles: AppearanceFile[];
}

interface LinkedSpecParameter {
  no: number;
  itemCheck: string;
  standardSpec: string | null;
  unit: string | null;
}

interface LinkedSpec {
  specId: string;
  materialDescription: string;
  information: string | null;
  parameters: LinkedSpecParameter[];
}

/** Satu baris History = satu Item Check -- kalau 1 Order/Check Results punya 25 Item
 * Check, History menampilkan 25 baris dengan Order/Batch/Customer dst yang sama. */
interface HistoryFlatRow {
  key: string;
  checkId: string;
  timestamp: string;
  order: string;
  batch: string | null;
  materialDescription: string | null;
  customer: string | null;
  iuPlant: string | null;
  lotCoa: string | null;
  itemCheck: string;
  spec: string;
  start: string;
  finish: string;
  result: string;
  pic: string;
  inputBy: string;
  raw: CheckRow;
}

function flattenHistoryRows(checks: CheckRow[]): HistoryFlatRow[] {
  const rows: HistoryFlatRow[] = [];
  for (const r of checks) {
    const params = r.parameters.length > 0 ? r.parameters : [null];
    for (const p of params) {
      rows.push({
        key: `${r.checkId}-${p ? p.no : "none"}`,
        checkId: r.checkId,
        timestamp: r.timestamp,
        order: r.order,
        batch: r.batch,
        materialDescription: r.materialDescription,
        customer: r.customer,
        iuPlant: r.iuPlant,
        lotCoa: r.lotCoa,
        itemCheck: p ? p.parameter : "-",
        spec: p?.standard ?? "",
        start: p?.start ?? "",
        finish: p?.finish ?? "",
        result: p?.result ?? "",
        pic: p?.pic ?? "",
        inputBy: r.inputBy,
        raw: r,
      });
    }
  }
  return rows;
}

function paramRowFromSpec(p: LinkedSpecParameter): ParamRow {
  return {
    no: p.no,
    parameter: p.itemCheck,
    standard: [p.standardSpec, p.unit].filter(Boolean).join(" "),
    result: "",
    remark: "",
    start: "",
    finish: "",
    pic: "",
  };
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
  lotCoa: "",
  customer: "",
  custSegmen: "",
  remark: "",
  appearanceNotes: "",
};

const SPEC_TABLE_DEFAULT_WIDTHS: Record<string, number> = {
  no: 44,
  itemCheck: 220,
  spec: 130,
  start: 180,
  finish: 180,
  result: 90,
  verdict: 90,
  pic: 110,
};

/** Lebar default (px) kolom "Order .. Remark" -- dipakai sbg fallback sebelum user pernah drag-resize. */
const HEADER_TABLE_DEFAULT_WIDTHS: Record<string, number> = {
  order: 140,
  materialNumber: 140,
  materialDescription: 280,
  batch: 120,
  orderQty: 120,
  plant: 100,
  iuPlant: 140,
  codeTanki: 140,
  customer: 280,
  custSegmen: 180,
  lotCoa: 180,
  remark: 320,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const HEADER_TABLE_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription", "batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki", "customer", "custSegmen", "lotCoa"],
  ["remark"],
];

/** Header tabel Spec Parameters dengan drag-handle di kanan utk mengubah lebar kolom bebas. */
function ResizableHeader({ width, onResizeStart, children }: { width: number; onResizeStart: (e: ReactMouseEvent) => void; children: ReactNode }) {
  return (
    <th style={{ width, position: "relative" }}>
      {children}
      <div
        onMouseDown={onResizeStart}
        style={{ position: "absolute", right: 0, top: 0, height: "100%", width: 6, cursor: "col-resize" }}
      />
    </th>
  );
}

export default function CheckResultsPage({
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
  const isViewOnly = getMenuLevel(user, "checkResults") === "VIEW";
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  const [params, setParams] = useState<ParamRow[]>([]);
  const [specStatus, setSpecStatus] = useState<"idle" | "loading" | "found" | "not-found">("idle");
  const [linkedSpecId, setLinkedSpecId] = useState<string | null>(null);
  const [specInformation, setSpecInformation] = useState<string | null>(null);
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null);
  const [lastSavedCheckId, setLastSavedCheckId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ order: "", materialNumber: "", materialDescription: "", batch: "" });
  const appearanceFileInputRef = useRef<HTMLInputElement>(null);
  const {
    widths: specColWidths,
    beginResize: beginColResize,
    reset: resetSpecColWidths,
  } = useResizableColWidths(SPEC_TABLE_DEFAULT_WIDTHS, "specParamsColWidths");
  const {
    widths: headerColWidths,
    beginResize: beginHeaderColResize,
    guideX: headerGuideX,
    reset: resetHeaderColWidths,
  } = useResizableColWidths(HEADER_TABLE_DEFAULT_WIDTHS, "checkResultsHeaderColWidths", HEADER_TABLE_COL_ROWS);

  function resetAllColWidths() {
    resetHeaderColWidths();
    resetSpecColWidths();
  }

  const historyQuery = useQuery({
    queryKey: ["check-results-history", filters],
    queryFn: () => {
      const qs = new URLSearchParams(filters as Record<string, string>).toString();
      return api.get<{ success: boolean; data: CheckRow[] }>(`/check-results?${qs}`).then((r) => r.data);
    },
    // Mode "embedded" (pop-up "Tahap Selanjutnya", 2026-07-31) cuma
    // nampilin form Input -- lihat komentar sama di PremixAftermixPage.tsx.
    enabled: !embedded,
  });

  const historyRows = useMemo(() => flattenHistoryRows(historyQuery.data ?? []), [historyQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, parameters: params };
      return editingCheckId
        ? api.put<{ success: boolean; data: CheckRow }>(`/check-results/${editingCheckId}`, payload)
        : api.post<{ success: boolean; data: CheckRow }>("/check-results", payload);
    },
    onSuccess: (res) => {
      setMessage(editingCheckId ? "Check Results berhasil diperbarui." : "Check Results berhasil disimpan.");
      setError("");
      setLastSavedCheckId(res.data.checkId);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["check-results-history"] });
      onSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (checkId: string) => api.delete(`/check-results/${checkId}`),
    onSuccess: () => {
      setMessage("Check Results berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["check-results-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!lastSavedCheckId) throw new Error("Simpan Check Results terlebih dahulu sebelum mengunggah lampiran.");
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/check-results/${lastSavedCheckId}/appearance-files`, formData);
    },
    onSuccess: () => {
      setMessage("File Appearance berhasil diunggah.");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["check-results-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal mengunggah file."),
  });

  function handleAppearanceFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  }

  /** Ambil Spec Parameters dari Product Spek (menu "Creating Product Spek") berdasarkan
   * Material Number -- Item Check & Standard/Spec TIDAK diketik manual lagi di sini,
   * supaya QC selalu mengacu ke spec yang sudah disetujui. */
  async function loadSpecForMaterial(materialNumber: string) {
    const matNo = materialNumber.trim();
    if (!matNo) {
      setSpecStatus("idle");
      setLinkedSpecId(null);
      setSpecInformation(null);
      setParams([]);
      return;
    }
    setSpecStatus("loading");
    try {
      const res = await api.get<{ success: boolean; data: LinkedSpec }>(`/product-specs/by-material/${encodeURIComponent(matNo)}`);
      setLinkedSpecId(res.data.specId);
      setSpecInformation(res.data.information ?? null);
      setParams(res.data.parameters.map(paramRowFromSpec));
      setSpecStatus("found");
    } catch {
      setLinkedSpecId(null);
      setSpecInformation(null);
      setParams([]);
      setSpecStatus("not-found");
    }
  }

  /** Cek apakah Order ini sudah pernah diinput & masuk ke History -- null kalau belum pernah. */
  async function findExistingCheckResult(order: string): Promise<CheckRow | null> {
    try {
      const res = await api.get<{ success: boolean; data: CheckRow | null }>(`/check-results/by-order/${encodeURIComponent(order)}`);
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      batch: data.batch ?? "",
      orderQty: data.orderQty ?? "",
      plant: data.plant ?? "",
    }));

    // Order ini sudah pernah diinput sebelumnya (ada di History) -- tampilkan lagi
    // data yang sudah tersimpan, sama seperti klik tombol Edit dari History.
    const existing = await findExistingCheckResult(data.order);
    if (existing) {
      startEdit(existing);
      setMessage(`Order ${data.order} sudah pernah diinput sebelumnya (${existing.checkId}) — data tersimpan ditampilkan untuk diedit.`);
      return;
    }

    setEditingCheckId(null);
    void loadSpecForMaterial(data.materialNumber ?? "");
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
  }

  // Mode pop-up "Tahap Selanjutnya" (embedded+initialOrder) -- lihat komentar
  // sama di PremixAftermixPage.tsx.
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

  function resetForm() {
    setForm(emptyForm);
    setParams([]);
    setSpecStatus("idle");
    setLinkedSpecId(null);
    setSpecInformation(null);
    setEditingCheckId(null);
  }

  function startEdit(row: CheckRow) {
    setEditingCheckId(row.checkId);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch ?? "",
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      codeTanki: row.codeTanki ?? "",
      lotCoa: row.lotCoa ?? "",
      customer: row.customer ?? "",
      custSegmen: row.custSegmen ?? "",
      remark: row.remark ?? "",
      appearanceNotes: row.appearanceNotes ?? "",
    });
    setParams(
      row.parameters.map((p) => ({
        no: p.no,
        parameter: p.parameter,
        standard: p.standard ?? "",
        result: p.result ?? "",
        remark: p.remark ?? "",
        start: p.start ?? "",
        finish: p.finish ?? "",
        pic: p.pic ?? "",
      }))
    );
    setLastSavedCheckId(row.checkId);
    setLinkedSpecId(null);
    setSpecInformation(null);
    setSpecStatus("found");
    setTab("input");
    setMessage("");
    setError("");
  }

  function updateParam(idx: number, patch: Partial<ParamRow>) {
    setParams((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  /** IU Plant, Code Tanki, Customer, dan Remark wajib diisi sebelum Save ATAU Print. */
  function validateRequiredFields(): string | null {
    if (!form.iuPlant.trim()) return "IU Plant wajib diisi sebelum Save/Print.";
    if (!form.codeTanki.trim()) return "Code Tanki wajib diisi sebelum Save/Print.";
    if (!form.customer.trim()) return "Customer wajib diisi sebelum Save/Print.";
    if (!form.remark.trim()) return "Remark wajib diisi sebelum Save/Print.";
    const invalidPic = params.find((p) => !isKnownEmployeeName(employees, p.pic));
    if (invalidPic) return `PIC "${invalidPic.pic}" tidak ditemukan di Data Karyawan. Pilih dari daftar saran.`;
    const incompleteRow = params.find((p) => p.result.trim() && (!p.start || !p.finish || !p.pic.trim()));
    if (incompleteRow) return `Start/Finish/PIC "${incompleteRow.parameter}" wajib diisi karena Result sudah diisi.`;
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    const validationError = validateRequiredFields();
    if (validationError) {
      setError(validationError);
      return;
    }
    saveMutation.mutate();
  }

  /** Print langsung dari isi form saat ini (tidak perlu Save Check Results dulu, tapi field wajib tetap harus terisi). */
  function printCurrentForm() {
    const validationError = validateRequiredFields();
    if (validationError) {
      setMessage("");
      setError(validationError);
      return;
    }
    setError("");
    openCheckSheetPrintWindow({ ...form, parameters: params, specInformation, inputBy: user?.nik ?? "" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          {!isViewOnly && (
            <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
              {editingCheckId ? "Edit Check Results" : "Input Check Results"}
            </button>
          )}
          <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
            History
          </button>
        </div>
      )}

      {(embedded || tab === "input") && (
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-header">{editingCheckId ? `Edit Check Results — ${editingCheckId}` : "Input Check Results"}</div>
          <div className="panel-body">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetAllColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <div className="excel-block">
              {headerGuideX !== null && <div className="col-align-guide" style={{ left: headerGuideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={headerColWidths.order} onResizeStart={beginHeaderColResize("order")}>
                  <OrderLookup bare value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={headerColWidths.materialNumber} onResizeStart={beginHeaderColResize("materialNumber")}>
                  <input value={form.materialNumber} readOnly />
                </ExcelField>
                <ExcelField
                  label="Material Description"
                  widthPx={headerColWidths.materialDescription}
                  onResizeStart={beginHeaderColResize("materialDescription")}
                >
                  <input value={form.materialDescription} readOnly />
                </ExcelField>
                <ExcelField label="Batch" widthPx={headerColWidths.batch} onResizeStart={beginHeaderColResize("batch")}>
                  <input value={form.batch} readOnly />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={headerColWidths.orderQty} onResizeStart={beginHeaderColResize("orderQty")}>
                  <input value={form.orderQty} readOnly />
                </ExcelField>
                <ExcelField label="Plant" widthPx={headerColWidths.plant} onResizeStart={beginHeaderColResize("plant")}>
                  <input value={form.plant} readOnly />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant *" widthPx={headerColWidths.iuPlant} onResizeStart={beginHeaderColResize("iuPlant")}>
                  <IuPlantSelect bare id="icr-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} required />
                </ExcelField>
                <ExcelField label="Code Tanki *" widthPx={headerColWidths.codeTanki} onResizeStart={beginHeaderColResize("codeTanki")}>
                  <TankSelect bare id="icr-tank" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} required />
                </ExcelField>
                <ExcelField label="Customer *" widthPx={headerColWidths.customer} onResizeStart={beginHeaderColResize("customer")}>
                  <input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Cust Segmen" widthPx={headerColWidths.custSegmen} onResizeStart={beginHeaderColResize("custSegmen")}>
                  <input value={form.custSegmen} onChange={(e) => setForm({ ...form, custSegmen: e.target.value })} />
                </ExcelField>
                <ExcelField label="Lot COA" widthPx={headerColWidths.lotCoa} onResizeStart={beginHeaderColResize("lotCoa")}>
                  <input value={form.lotCoa} onChange={(e) => setForm({ ...form, lotCoa: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Remark *" widthPx={headerColWidths.remark} onResizeStart={beginHeaderColResize("remark")}>
                  <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} required />
                </ExcelField>
              </ExcelRow>
            </div>
            <p style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--text-muted)" }}>
              * IU Plant, Code Tanki, Customer, dan Remark wajib diisi sebelum bisa Save atau Print. Order, Material
              Number, Material Description, Batch, Order Qty, dan Plant otomatis terisi dari hasil pencarian Order. Tarik
              garis di sisi kanan tiap kolom untuk mengubah lebarnya.
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, flexWrap: "wrap", gap: 10 }}>
              <h3 className="pp-section-title" style={{ margin: 0 }}>
                Spec Parameters
              </h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-success" onClick={printCurrentForm}>
                  Print Cek Sheet
                </button>
                <button className="btn" type="submit" disabled={saveMutation.isPending || params.length === 0}>
                  {saveMutation.isPending ? "Menyimpan..." : "Save"}
                </button>
                {editingCheckId && (
                  <button type="button" className="btn btn-outline" onClick={resetForm}>
                    Batal Edit
                  </button>
                )}
              </div>
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            {specStatus === "idle" && (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Cari Order dulu (atau isi Material Number) supaya Item Check &amp; Standard/Spec otomatis
                terisi dari menu <strong>Creating Product Spek</strong>.
              </p>
            )}
            {specStatus === "loading" && <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Memuat Product Spek...</p>}
            {specStatus === "not-found" && (
              <p className="error-text">
                Belum ada Product Spek untuk Material Number "{form.materialNumber}". Buat dulu di menu{" "}
                <strong>Creating Product Spek</strong> sebelum bisa Input Check Results untuk material ini.
              </p>
            )}
            {specStatus === "found" && linkedSpecId && (
              <p className="status-text">
                Spec Parameters terhubung ke Product Spek {linkedSpecId} ({params.length} item check).
              </p>
            )}
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Tarik garis di sisi kanan header untuk mengubah lebar kolom.</p>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <ResizableHeader width={specColWidths.no} onResizeStart={beginColResize("no")}>No</ResizableHeader>
                    <ResizableHeader width={specColWidths.itemCheck} onResizeStart={beginColResize("itemCheck")}>Item Check</ResizableHeader>
                    <ResizableHeader width={specColWidths.spec} onResizeStart={beginColResize("spec")}>Spec</ResizableHeader>
                    <ResizableHeader width={specColWidths.result} onResizeStart={beginColResize("result")}>Result</ResizableHeader>
                    <ResizableHeader width={specColWidths.verdict} onResizeStart={beginColResize("verdict")}>Verdict</ResizableHeader>
                    <ResizableHeader width={specColWidths.start} onResizeStart={beginColResize("start")}>Start</ResizableHeader>
                    <ResizableHeader width={specColWidths.finish} onResizeStart={beginColResize("finish")}>Finish</ResizableHeader>
                    <ResizableHeader width={specColWidths.pic} onResizeStart={beginColResize("pic")}>PIC</ResizableHeader>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p, idx) => {
                    const verdict = evaluateSpec(p.standard, p.result);
                    return (
                      <tr key={idx}>
                        <td style={{ width: 40 }}>{p.no}</td>
                        <td>{p.parameter}</td>
                        <td>{p.standard || "-"}</td>
                        <td>
                          <input
                            style={{ background: SPEC_VERDICT_COLOR[verdict], width: "100%" }}
                            value={p.result}
                            onChange={(e) => updateParam(idx, { result: e.target.value })}
                          />
                        </td>
                        <td>{SPEC_VERDICT_LABEL[verdict]}</td>
                        <td><input type="datetime-local" style={{ width: "100%" }} value={toDateTimeLocalValue(p.start)} onChange={(e) => updateParam(idx, { start: e.target.value })} /></td>
                        <td><input type="datetime-local" style={{ width: "100%" }} value={toDateTimeLocalValue(p.finish)} onChange={(e) => updateParam(idx, { finish: e.target.value })} /></td>
                        <td>
                          <EmployeeNameSelect bare id={`pic-${idx}`} value={p.pic} onChange={(v) => updateParam(idx, { pic: v })} />
                        </td>
                      </tr>
                    );
                  })}
                  {params.length === 0 && (
                    <tr>
                      <td colSpan={8}>Belum ada Spec Parameters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, flexWrap: "wrap", gap: 10 }}>
              <h3 className="pp-section-title" style={{ margin: 0 }}>
                Appearance Check Results
              </h3>
              <input
                ref={appearanceFileInputRef}
                type="file"
                accept="image/*,application/pdf"
                style={{ display: "none" }}
                onChange={handleAppearanceFilePicked}
              />
              <button
                type="button"
                className="btn btn-info"
                disabled={!lastSavedCheckId || uploadMutation.isPending}
                title={!lastSavedCheckId ? "Simpan Check Results terlebih dahulu sebelum upload" : undefined}
                onClick={() => appearanceFileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? "Mengunggah..." : "Upload File"}
              </button>
            </div>
            <div className="field">
              <AutoGrowTextarea value={form.appearanceNotes} onChange={(e) => setForm({ ...form, appearanceNotes: e.target.value })} />
            </div>

            <h3 className="pp-section-title" style={{ marginTop: 18 }}>
              Information
            </h3>
            <div
              style={{
                minHeight: 90,
                padding: "10px 14px",
                fontSize: "0.88rem",
                whiteSpace: "pre-wrap",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              {form.order.trim() ? specInformation || " " : " "}
            </div>
          </div>
        </form>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">History Input Check Results</div>
          <div className="panel-body">
            <div className="field-grid" style={{ marginBottom: 12 }}>
              <div className="field">
                <label>Order</label>
                <input value={filters.order} onChange={(e) => setFilters({ ...filters, order: e.target.value })} />
              </div>
              <div className="field">
                <label>Material Number</label>
                <input value={filters.materialNumber} onChange={(e) => setFilters({ ...filters, materialNumber: e.target.value })} />
              </div>
              <div className="field">
                <label>Material Description</label>
                <input value={filters.materialDescription} onChange={(e) => setFilters({ ...filters, materialDescription: e.target.value })} />
              </div>
              <div className="field">
                <label>Batch</label>
                <input value={filters.batch} onChange={(e) => setFilters({ ...filters, batch: e.target.value })} />
              </div>
            </div>
            <DataTable
              rowKey={(r: HistoryFlatRow) => r.key}
              exportFileName="history-check-results"
              storageKey="check-results-history-v2"
              rows={historyRows}
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
                { key: "customer", label: "Customer", render: (r) => r.customer },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "itemCheck", label: "Item Check", render: (r) => r.itemCheck },
                { key: "spec", label: "Spec", render: (r) => r.spec || "-" },
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
                {
                  key: "result",
                  label: "Result",
                  render: (r) => {
                    const verdict = evaluateSpec(r.spec, r.result);
                    return (
                      <span style={{ background: SPEC_VERDICT_COLOR[verdict], padding: "1px 6px", borderRadius: 3, display: "inline-block" }}>
                        {r.result || "-"}
                      </span>
                    );
                  },
                  csvValue: (r) => r.result || "-",
                },
                {
                  key: "verdict",
                  label: "Verdict",
                  render: (r) => {
                    const verdict = evaluateSpec(r.spec, r.result);
                    return <span>{SPEC_VERDICT_LABEL[verdict]}</span>;
                  },
                  csvValue: (r) => SPEC_VERDICT_LABEL[evaluateSpec(r.spec, r.result)],
                },
                {
                  key: "pic",
                  label: "PIC",
                  render: (r) => {
                    if (!r.pic) return "-";
                    const emp = (employees ?? []).find((e) => e.fullName.trim().toLowerCase() === r.pic.trim().toLowerCase());
                    return emp ? `${r.pic} (${emp.employeeId} · ${emp.departemen ?? "-"})` : r.pic;
                  },
                },
                { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
                { key: "lotCoa", label: "Lot COA", render: (r) => r.lotCoa },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" onClick={() => startEdit(r.raw)}>
                        Edit
                      </button>
                      {getMenuLevel(user, "checkResults") === "INPUT" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          onClick={() => {
                            if (confirm(`Hapus Check Results untuk Order ${r.order}?`)) deleteMutation.mutate(r.checkId);
                          }}
                        >
                          Hapus
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
