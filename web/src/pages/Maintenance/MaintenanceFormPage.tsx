import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import TankSelect from "../../components/TankSelect";
import EmployeeNameSelect, { isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { toDateTimeLocalValue } from "../../lib/datetime";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { handleExcelGridKeyNav } from "../../lib/excelGridNav";
import { emptyMaintenanceForm, MaintenanceForm, MaintenanceRow } from "./types";

const MAINTENANCE_COL_DEFAULT_WIDTHS: Record<string, number> = {
  codeTanki: 200,
  priority: 160,
  reportedBy: 200,
  technician: 200,
  scheduledDate: 190,
  start: 200,
  finish: 200,
};

const MAINTENANCE_COL_ROWS: string[][] = [
  ["codeTanki", "priority", "reportedBy", "technician"],
  ["scheduledDate", "start", "finish"],
];

function toDateValue(v: string): string {
  return toDateTimeLocalValue(v).slice(0, 10);
}

/**
 * "Form Input Maintenance" (2026-08-06, instruksi eksplisit user) -- halaman
 * TERPISAH dari List Job/Jadwal Pengerjaan (beda dari modul lain yg Input +
 * History gabung 1 komponen bertab), krn user eksplisit minta 3 sub-menu
 * sendiri2 di sidebar. Dua jalur masuk lewat query string:
 * - `?codeTanki=X` -- dari checkbox "Damaged" di Master Data > Tanki
 *   (MasterDataPage.tsx), form langsung terisi Code Tanki-nya.
 * - `?editId=123` -- dari tombol Edit di List Job Maintenance
 *   (MaintenanceListPage.tsx), fetch GET /maintenance/:id lalu isi form.
 */
export default function MaintenanceFormPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MaintenanceForm>(emptyMaintenanceForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    MAINTENANCE_COL_DEFAULT_WIDTHS,
    "maintenanceFormColWidths",
    MAINTENANCE_COL_ROWS
  );
  /** Navigasi panah ala Excel antar ExcelField -- lihat lib/excelGridNav.ts. */
  const gridNav = (key: string) => ({ navKey: key, onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleExcelGridKeyNav(e, MAINTENANCE_COL_ROWS) });

  const editId = searchParams.get("editId");
  const codeTankiParam = searchParams.get("codeTanki");

  const editQuery = useQuery({
    queryKey: ["maintenance-edit", editId],
    queryFn: () => api.get<{ success: boolean; data: MaintenanceRow }>(`/maintenance/${editId}`).then((r) => r.data),
    enabled: !!editId,
  });

  useEffect(() => {
    if (editQuery.data) {
      const row = editQuery.data;
      setEditingId(row.id);
      setForm({
        codeTanki: row.codeTanki,
        description: row.description,
        reportedBy: row.reportedBy,
        reportedByNik: row.reportedByNik ?? null,
        priority: row.priority ?? "",
        technician: row.technician ?? "",
        technicianNik: row.technicianNik ?? null,
        scheduledDate: toDateValue(row.scheduledDate ?? ""),
        start: toDateTimeLocalValue(row.start),
        finish: toDateTimeLocalValue(row.finish),
        remark: row.remark ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQuery.data]);

  useEffect(() => {
    if (!editId && codeTankiParam) {
      setForm((f) => ({ ...f, codeTanki: codeTankiParam }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, codeTankiParam]);

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? api.put<{ success: boolean; data: MaintenanceRow }>(`/maintenance/${editingId}`, form)
        : api.post<{ success: boolean; data: MaintenanceRow }>("/maintenance", form),
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      queryClient.invalidateQueries({ queryKey: ["maintenance-history"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-schedule"] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data Maintenance berhasil diperbarui." : "Data Maintenance berhasil disimpan.");
      }
      if (!wasEditing) {
        setForm(emptyMaintenanceForm);
        setEditingId(null);
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/maintenance/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["maintenance-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyMaintenanceForm);
    setMessage("");
    setError("");
    navigate("/maintenance/form");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isKnownEmployeeName(employees, form.reportedBy)) {
      setError("Pelapor tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (form.technician.trim() && !isKnownEmployeeName(employees, form.technician)) {
      setError("Teknisi/PIC Maintenance tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    saveMutation.mutate();
  }

  return (
    <div className="panel">
      <form className="panel-body" onSubmit={handleSubmit}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
            ↺ Reset Lebar Kolom
          </button>
        </div>
        <ExcelBlock title="Maintenance » Form Input Maintenance">
          {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
          <ExcelRow>
            <ExcelField label="Code Tanki / Objek" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")} {...gridNav("codeTanki")}>
              <TankSelect bare id="maintenance-code-tanki" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
            </ExcelField>
            <ExcelField label="Prioritas" widthPx={colWidths.priority} onResizeStart={beginResize("priority")} {...gridNav("priority")}>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="">-</option>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
              </select>
            </ExcelField>
            <ExcelField label="Pelapor" widthPx={colWidths.reportedBy} onResizeStart={beginResize("reportedBy")} {...gridNav("reportedBy")}>
              <EmployeeNameSelect
                bare
                id="maintenance-reported-by"
                value={form.reportedBy}
                employeeId={form.reportedByNik}
                onChange={(v, nik) => setForm({ ...form, reportedBy: v, reportedByNik: nik ?? null })}
                required
              />
            </ExcelField>
            <ExcelField label="Teknisi / PIC Maintenance" widthPx={colWidths.technician} onResizeStart={beginResize("technician")} {...gridNav("technician")}>
              <EmployeeNameSelect
                bare
                id="maintenance-technician"
                value={form.technician}
                employeeId={form.technicianNik}
                onChange={(v, nik) => setForm({ ...form, technician: v, technicianNik: nik ?? null })}
              />
            </ExcelField>
          </ExcelRow>
          <ExcelRow>
            <ExcelField label="Jadwal Pengerjaan" widthPx={colWidths.scheduledDate} onResizeStart={beginResize("scheduledDate")} {...gridNav("scheduledDate")}>
              <input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
            </ExcelField>
            <ExcelField label="Tanggal Mulai" widthPx={colWidths.start} onResizeStart={beginResize("start")} {...gridNav("start")}>
              <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </ExcelField>
            <ExcelField label="Tanggal Selesai" widthPx={colWidths.finish} onResizeStart={beginResize("finish")} {...gridNav("finish")}>
              <input type="datetime-local" value={form.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} />
            </ExcelField>
          </ExcelRow>
        </ExcelBlock>

        <div className="field" style={{ marginTop: 14 }}>
          <label>Deskripsi Kerusakan</label>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <label style={{ margin: 0 }}>Remark</label>
            <button type="button" className="btn" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
              Upload Foto
            </button>
            {attachmentFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachmentFile.name}</span>}
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)} />
          </div>
          <textarea rows={4} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
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
  );
}
