import { FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, fileUrl } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { ExcelBlock, ExcelRow, ExcelField, ExcelSubHeader } from "../../components/ExcelGrid";
import EmployeeNameSelect, { isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";

interface ApprovalRow {
  approvalId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  prepareProduksi: string | null;
  sprayMan: string | null;
  wetSample: string | null;
  panel: string | null;
  lotCoa: string | null;
  sendToTech: string | null;
  technicalDateReceiving: string | null;
  submitToCustomer: string | null;
  customer: string | null;
  custSegmen: string | null;
  techName: string | null;
  finishApp: string | null;
  remark: string | null;
  inputBy: string;
}

interface LotHistoryRow extends ApprovalRow {
  status: "Pending Approval" | "Approval" | "Oke Approval";
  processingTime: string;
  hasAttachment: boolean;
}

interface Attachment {
  id: number;
  fileName: string;
  filePath: string;
  remark: string | null;
  uploadedBy: string;
  timestamp: string;
}

const FILTER_COLUMNS = [
  { value: "order", label: "Order" },
  { value: "materialNumber", label: "Material Number" },
  { value: "materialDescription", label: "Material Description" },
  { value: "batch", label: "Batch" },
  { value: "plant", label: "Plant" },
  { value: "iuPlant", label: "IU Plant" },
  { value: "codeTanki", label: "Code Tanki" },
  { value: "sprayMan", label: "Spray Man" },
  { value: "customer", label: "Customer" },
  { value: "techName", label: "Tech Name" },
];

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  codeTanki: "",
  prepareProduksi: "",
  sprayMan: "",
  wetSample: "",
  panel: "",
  lotCoa: "",
  sendToTech: "",
  technicalDateReceiving: "",
  submitToCustomer: "",
  customer: "",
  custSegmen: "",
  techName: "",
  finishApp: "",
  remark: "",
};

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). Admin QC Stage/Mrp
 * Pic/Sales Pic/Lot Passed/QC to App/QC Passed DIPINDAH ke menu "Input Admin QC"
 * terpisah (2026-07-28, sesuai instruksi eksplisit user) -- tidak ada lagi di sini. */
const APPROVAL_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 140,
  materialNumber: 140,
  materialDescription: 220,
  batch: 120,
  orderQty: 110,
  plant: 100,
  iuPlant: 150,
  codeTankiRow2: 150,
  prepareDate: 170,
  sprayMan: 140,
  wetSample: 130,
  panel: 120,
  lotCoa: 170,
  sendToTech: 170,
  submitTech: 170,
  submitCust: 170,
  customer: 160,
  custSegmen: 150,
  techName: 160,
  finishApp: 170,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const APPROVAL_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription", "batch", "orderQty", "plant"],
  ["iuPlant", "codeTankiRow2"],
  ["prepareDate", "sprayMan", "wetSample", "panel", "lotCoa", "sendToTech"],
  ["submitTech", "submitCust", "customer", "custSegmen", "techName", "finishApp"],
];

export default function ApprovalPage() {
  const { user } = useAuth();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history">("input");
  const [form, setForm] = useState(emptyForm);
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    APPROVAL_COL_DEFAULT_WIDTHS,
    "approvalInputColWidths",
    APPROVAL_COL_ROWS
  );

  const [statusFilter, setStatusFilter] = useState("");
  const [filterCol, setFilterCol] = useState("order");
  const [filterValue, setFilterValue] = useState("");
  const [attachmentModalId, setAttachmentModalId] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ["approval-lot-history", statusFilter, filterCol, filterValue],
    queryFn: () => {
      const qs = new URLSearchParams({ status: statusFilter, filterCol, filterValue }).toString();
      return api.get<{ success: boolean; data: LotHistoryRow[] }>(`/approvals/lot-history?${qs}`).then((r) => r.data);
    },
  });

  const attachmentsQuery = useQuery({
    queryKey: ["approval-attachments", attachmentModalId],
    queryFn: () => api.get<{ success: boolean; data: Attachment[] }>(`/approvals/${attachmentModalId}/attachments`).then((r) => r.data),
    enabled: !!attachmentModalId,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingApprovalId
        ? api.put<{ success: boolean; data: ApprovalRow }>(`/approvals/${editingApprovalId}`, form)
        : api.post<{ success: boolean; data: ApprovalRow }>("/approvals", form),
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingApprovalId;
      setForm(emptyForm);
      setEditingApprovalId(null);
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
      if (attachFile) {
        uploadMutation.mutate({ approvalId: res.data.approvalId, file: attachFile });
      } else {
        setMessage(wasEditing ? "Data Approval berhasil diperbarui." : "Data Approval berhasil disimpan.");
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ approvalId, file }: { approvalId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/approvals/${approvalId}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachFile(null);
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  const deleteMutation = useMutation({
    mutationFn: (approvalId: string) => api.delete(`/approvals/${approvalId}`),
    onSuccess: () => {
      setMessage("Data Approval berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: ({ approvalId, id }: { approvalId: string; id: number }) => api.delete(`/approvals/${approvalId}/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-attachments"] });
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
    },
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
      const res = await api.get<{ success: boolean; data: ApprovalRow | null }>(`/approvals/latest-by-order/${encodeURIComponent(data.order)}`);
      if (res.data) {
        const latest = res.data;
        setForm((f) => ({
          ...f,
          customer: f.customer || latest.customer || "",
          techName: f.techName || latest.techName || "",
          panel: f.panel || latest.panel || "",
          wetSample: f.wetSample || latest.wetSample || "",
          iuPlant: f.iuPlant || latest.iuPlant || "",
          codeTanki: f.codeTanki || latest.codeTanki || "",
          remark: f.remark || latest.remark || "",
          prepareProduksi: f.prepareProduksi || latest.prepareProduksi || "",
          sprayMan: f.sprayMan || latest.sprayMan || "",
          lotCoa: f.lotCoa || latest.lotCoa || "",
          sendToTech: f.sendToTech || latest.sendToTech || "",
          technicalDateReceiving: f.technicalDateReceiving || latest.technicalDateReceiving || "",
          submitToCustomer: f.submitToCustomer || latest.submitToCustomer || "",
          finishApp: f.finishApp || latest.finishApp || "",
          custSegmen: f.custSegmen || latest.custSegmen || "",
        }));
      }
    } catch {
      /* tidak ada histori Approval sebelumnya untuk Order ini -- biarkan kosong */
    }
    try {
      const ctx = await api.get<{ success: boolean; data: { iuPlant: string; codeTanki: string } | null }>(
        `/master-data/order-context/${encodeURIComponent(data.order)}`
      );
      if (ctx.data) {
        setForm((f) => ({
          ...f,
          iuPlant: f.iuPlant || ctx.data!.iuPlant || "",
          codeTanki: f.codeTanki || ctx.data!.codeTanki || "",
        }));
      }
    } catch {
      /* saran IU Plant/Code Tanki bersifat opsional -- Remark SENGAJA tidak ikut disarankan
         dari order-context lintas modul -- kalau gagal, biarkan user isi manual */
    }
  }

  function startEdit(row: LotHistoryRow) {
    setEditingApprovalId(row.approvalId);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch ?? "",
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      codeTanki: row.codeTanki ?? "",
      prepareProduksi: row.prepareProduksi ?? "",
      sprayMan: row.sprayMan ?? "",
      wetSample: row.wetSample ?? "",
      panel: row.panel ?? "",
      lotCoa: row.lotCoa ?? "",
      sendToTech: row.sendToTech ?? "",
      technicalDateReceiving: row.technicalDateReceiving ?? "",
      submitToCustomer: row.submitToCustomer ?? "",
      customer: row.customer ?? "",
      custSegmen: row.custSegmen ?? "",
      techName: row.techName ?? "",
      finishApp: row.finishApp ?? "",
      remark: row.remark ?? "",
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingApprovalId(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isKnownEmployeeName(employees, form.techName)) {
      setError("Tech Name tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    saveMutation.mutate();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
          Input Schedule
        </button>
        <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
          Lot History
        </button>
      </div>

      {tab === "input" && (
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-body">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <ExcelBlock title="Production & MRP Schedule » Approval, Input Proses">
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")}>
                  <OrderLookup bare value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")}>
                  <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} required />
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
                  <IuPlantSelect bare id="approval-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={colWidths.codeTankiRow2} onResizeStart={beginResize("codeTankiRow2")}>
                  <TankSelect bare id="approval-tank-1" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} required={false} />
                </ExcelField>
              </ExcelRow>
              <ExcelSubHeader label="Production Input Column" color="production" />
              <ExcelRow>
                <ExcelField label="Prepare Date" widthPx={colWidths.prepareDate} onResizeStart={beginResize("prepareDate")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.prepareProduksi)} onChange={(e) => setForm({ ...form, prepareProduksi: e.target.value })} />
                </ExcelField>
                <ExcelField label="Spray Man" widthPx={colWidths.sprayMan} onResizeStart={beginResize("sprayMan")}>
                  <EmployeeNameSelect bare id="approval-spray-man" value={form.sprayMan} onChange={(v) => setForm({ ...form, sprayMan: v })} />
                </ExcelField>
                <ExcelField label="Wet Sample" widthPx={colWidths.wetSample} onResizeStart={beginResize("wetSample")}>
                  <input value={form.wetSample} onChange={(e) => setForm({ ...form, wetSample: e.target.value })} />
                </ExcelField>
                <ExcelField label="Panel" widthPx={colWidths.panel} onResizeStart={beginResize("panel")}>
                  <input value={form.panel} onChange={(e) => setForm({ ...form, panel: e.target.value })} />
                </ExcelField>
                <ExcelField label="Lot COA" widthPx={colWidths.lotCoa} onResizeStart={beginResize("lotCoa")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.lotCoa)}
                    onChange={(e) => setForm({ ...form, lotCoa: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Send To Tech" widthPx={colWidths.sendToTech} onResizeStart={beginResize("sendToTech")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.sendToTech)} onChange={(e) => setForm({ ...form, sendToTech: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelSubHeader label="Technical Input Column" color="technical" />
              <ExcelRow>
                <ExcelField label="Submit Tech" widthPx={colWidths.submitTech} onResizeStart={beginResize("submitTech")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.technicalDateReceiving)}
                    onChange={(e) => setForm({ ...form, technicalDateReceiving: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Submit Cust" widthPx={colWidths.submitCust} onResizeStart={beginResize("submitCust")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.submitToCustomer)} onChange={(e) => setForm({ ...form, submitToCustomer: e.target.value })} />
                </ExcelField>
                <ExcelField label="Customer" widthPx={colWidths.customer} onResizeStart={beginResize("customer")}>
                  <input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
                </ExcelField>
                <ExcelField label="Cust Segmen" widthPx={colWidths.custSegmen} onResizeStart={beginResize("custSegmen")}>
                  <input value={form.custSegmen} onChange={(e) => setForm({ ...form, custSegmen: e.target.value })} />
                </ExcelField>
                <ExcelField label="Tech Name" widthPx={colWidths.techName} onResizeStart={beginResize("techName")}>
                  <EmployeeNameSelect bare id="approval-tech-name" value={form.techName} onChange={(v) => setForm({ ...form, techName: v })} />
                </ExcelField>
                <ExcelField label="Finish App" widthPx={colWidths.finishApp} onResizeStart={beginResize("finishApp")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.finishApp)} onChange={(e) => setForm({ ...form, finishApp: e.target.value })} />
                </ExcelField>
              </ExcelRow>
            </ExcelBlock>

            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Remark</label>
                <button type="button" className="btn btn-info" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
                  Upload File
                </button>
                {attachFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachFile.name}</span>}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <textarea rows={5} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-success" type="submit" disabled={saveMutation.isPending || uploadMutation.isPending}>
                {saveMutation.isPending || uploadMutation.isPending ? "Menyimpan..." : editingApprovalId ? "Simpan Perubahan" : "Save Data"}
              </button>
              {editingApprovalId && (
                <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                  Batal Edit
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">Approval — Lot History</div>
          <div className="panel-body">
            <div className="field-grid" style={{ marginBottom: 12 }}>
              <div className="field">
                <label>Status</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Semua</option>
                  <option value="Pending Approval">Pending Approval</option>
                  <option value="Approval">Approval</option>
                  <option value="Oke Approval">Oke Approval</option>
                </select>
              </div>
              <div className="field">
                <label>Filter Kolom</label>
                <select value={filterCol} onChange={(e) => setFilterCol(e.target.value)}>
                  {FILTER_COLUMNS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Nilai</label>
                <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} />
              </div>
            </div>

            <DataTable
              rowKey={(r: LotHistoryRow) => r.approvalId}
              exportFileName="approval-lot-history"
              storageKey="approval-lot-history"
              rows={historyQuery.data ?? []}
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
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
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
                { key: "techName", label: "Tech Name", render: (r) => r.techName },
                {
                  key: "finishApp",
                  label: "Finish App",
                  render: (r) => formatDateTime(r.finishApp),
                  csvValue: (r) => toExcelDateTimeString(r.finishApp),
                },
                { key: "remark", label: "Remark", render: (r) => r.remark },
                { key: "inputBy", label: "Input By", render: (r) => r.inputBy },
                { key: "status", label: "Status", render: (r) => r.status },
                { key: "processingTime", label: "Processing Time", render: (r) => r.processingTime },
                { key: "hasAttachment", label: "Lampiran", render: (r) => (r.hasAttachment ? "Filled" : "No File"), csvValue: (r) => (r.hasAttachment ? "Filled" : "No File") },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                        ✏️
                      </button>
                      <button
                        className="btn btn-outline"
                        type="button"
                        title="Lampiran"
                        aria-label="Lampiran"
                        style={{ padding: "6px 10px" }}
                        onClick={() => setAttachmentModalId(r.approvalId)}
                      >
                        📎
                      </button>
                      {user?.access === "FULL_ACCESS" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data Approval untuk Order ${r.order}?`)) deleteMutation.mutate(r.approvalId);
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

      {attachmentModalId && (
        <Modal title={`Lampiran — ${attachmentModalId}`} onClose={() => setAttachmentModalId(null)}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(attachmentsQuery.data ?? []).map((a) => (
              <li key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <a href={fileUrl(a.filePath)} target="_blank" rel="noreferrer">
                  {a.fileName}
                </a>
                {user?.access === "FULL_ACCESS" && (
                  <button
                    className="btn btn-danger"
                    onClick={() => deleteAttachmentMutation.mutate({ approvalId: attachmentModalId, id: a.id })}
                  >
                    Hapus
                  </button>
                )}
              </li>
            ))}
            {(attachmentsQuery.data ?? []).length === 0 && <li>Belum ada lampiran.</li>}
          </ul>
        </Modal>
      )}
    </div>
  );
}
