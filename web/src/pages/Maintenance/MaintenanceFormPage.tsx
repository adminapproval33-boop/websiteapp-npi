import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import EmployeeNameSelect, { isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { toDateTimeLocalValue, validateNotFutureDate } from "../../lib/datetime";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { handleExcelGridKeyNav } from "../../lib/excelGridNav";
import { emptyMaintenanceForm, MaintenanceForm, MaintenanceRow } from "./types";
import { openMaintenancePrintWindow } from "../../lib/printMaintenance";

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
 * sendiri2 di sidebar. Jalur masuk lewat query string:
 * - `?codeTanki=X` -- kalau ada yg mengetik/paste URL manual dgn Code
 *   Tanki/Code Mesin tertentu. Field "Equipment Type" ini INPUT TEKS BEBAS
 *   (2026-09-22, instruksi eksplisit user: dilepas dari dropdown/saran
 *   Master Data Tanki+Mesin -- equipment yg rusak bisa apa saja, bukan cuma
 *   Tanki/Mesin, mis. mixer/gerobak/panel kelistrikan yg tidak terdaftar di
 *   Master Data manapun). Checkbox "Maintenance" di Tank/Mesin Monitoring SENDIRI
 *   TIDAK LAGI ke sini (2026-09-22, instruksi eksplisit user) -- dicentang
 *   langsung buka pop-up ringkas `MaintenanceQuickModal` di halaman yg sama,
 *   supaya user tidak perlu pindah halaman sama sekali. Detail lengkap yg
 *   tidak ada di pop-up itu (Tanggal Mulai/Selesai, lampiran foto) tetap
 *   dilengkapi lewat halaman ini, tapi masuknya lewat `?editId=` di bawah
 *   (List Job > Edit), bukan lagi lewat `?codeTanki=`.
 *
 * Kolom "Remark" (2026-09-22, instruksi eksplisit user) -- dilebur ke
 * "Deskripsi Kerusakan" (textarea "Deskripsi Kerusakan" yg lama DIHAPUS,
 * textarea "Remark" yg lama DIPAKAI ULANG label+binding-nya jadi "Deskripsi
 * Kerusakan"/`form.description`). `form.remark` TETAP ada di tipe form &
 * tetap dikirim ke server (supaya baris lama yg py isi Remark dari sebelum
 * revisi ini tidak hilang datanya kalau di-edit ulang), TAPI TIDAK ADA lagi
 * input UI utk mengisi/mengubahnya dari sini.
 * - `?editId=123` -- dari tombol Edit di List Job Maintenance
 *   (MaintenanceListPage.tsx), fetch GET /maintenance/:id lalu isi form.
 *
 * No Dok (2026-09-22, instruksi eksplisit user) -- BUKAN field input lagi,
 * dibuat OTOMATIS server (generateNoDok di maintenance.routes.ts) begitu Job
 * pertama kali disimpan. Makanya begitu Save (create) berhasil, form TIDAK
 * lagi direset ke kosong spt sebelumnya -- tetap di mode edit utk Job yg
 * baru dibuat itu, supaya No Dok-nya kelihatan.
 *
 * Tombol Print (2026-09-22, instruksi eksplisit user: disamakan dgn "Print
 * CS" di Input Check Results) -- SELALU aktif, TIDAK perlu Save dulu, cukup
 * field wajib (Equipment Type/Deskripsi Kerusakan/Pelapor) sudah terisi
 * (lihat `validateRequiredFields`, dipakai bareng oleh handleSubmit &
 * handlePrint). Kalau Job-nya belum pernah disimpan, No Dok tampil "-" di
 * hasil cetak (baru pasti ada begitu Save berhasil).
 */
export default function MaintenanceFormPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MaintenanceForm>(emptyMaintenanceForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savedNoDok, setSavedNoDok] = useState<string | null>(null);
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
      setSavedNoDok(row.noDok ?? null);
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
      // Tanggal Selesai baru terisi -> checkbox "Maintenance" di Tank/Mesin
      // Monitoring otomatis hilang centangnya di backend (releaseMaintenanceFlag,
      // 2026-09-22) -- invalidate juga di sini supaya kalau user balik ke
      // Monitoring, datanya sudah ter-refresh (bukan cache lama).
      if (res.data.finish) {
        queryClient.invalidateQueries({ queryKey: ["tank-status"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-mesin-status"] });
      }
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data Maintenance berhasil diperbarui." : "Data Maintenance berhasil disimpan.");
      }
      // Job baru dibuat (bukan edit) TETAP di mode edit utk Job itu (BUKAN
      // direset ke form kosong spt sebelumnya, 2026-09-22 instruksi eksplisit
      // user) -- No Dok baru terbentuk di sini, & tombol Print butuh Job-nya
      // tetap "aktif" supaya bisa langsung dipakai tanpa cari-cari di List Job.
      setEditingId(res.data.id);
      setSavedNoDok(res.data.noDok ?? null);
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
    setSavedNoDok(null);
    setForm(emptyMaintenanceForm);
    setMessage("");
    setError("");
    navigate("/maintenance/form");
  }

  /** Equipment Type/Deskripsi Kerusakan/Pelapor wajib diisi sebelum Save ATAU
   * Print -- pola SAMA PERSIS dgn validateRequiredFields di
   * CheckResultsPage.tsx (2026-09-22, instruksi eksplisit user: tombol Print
   * di sini disamakan logikanya dgn "Print CS" -- bisa langsung cetak dari
   * isi form saat ini TANPA perlu Save dulu, asal field wajib sudah terisi). */
  function validateRequiredFields(): string | null {
    if (!form.codeTanki.trim()) return "Equipment Type wajib diisi sebelum Save/Print.";
    if (!form.description.trim()) return "Deskripsi Kerusakan wajib diisi sebelum Save/Print.";
    if (!form.reportedBy.trim()) return "Pelapor wajib diisi sebelum Save/Print.";
    if (!isKnownEmployeeName(employees, form.reportedBy)) return "Pelapor tidak ditemukan di Data Karyawan. Pilih dari daftar saran.";
    if (form.technician.trim() && !isKnownEmployeeName(employees, form.technician)) {
      return "Teknisi/PIC Maintenance tidak ditemukan di Data Karyawan. Pilih dari daftar saran.";
    }
    // Jadwal Pengerjaan (scheduledDate) SENGAJA TIDAK divalidasi -- itu tanggal
    // rencana/jadwal ke depan, wajar kalau lebih besar dari hari ini.
    return validateNotFutureDate(form.start, "Tanggal Mulai") ?? validateNotFutureDate(form.finish, "Tanggal Selesai");
  }

  /** Print langsung dari isi form saat ini (tidak perlu Save dulu, tapi field
   * wajib tetap harus terisi) -- kalau Job-nya SUDAH pernah disimpan,
   * No Dok asli (savedNoDok) ikut tercetak; kalau belum, No Dok tampil "-"
   * di hasil cetak (baru pasti begitu server benar2 membuatnya saat Save). */
  function handlePrint() {
    const validationError = validateRequiredFields();
    if (validationError) {
      setMessage("");
      setError(validationError);
      return;
    }
    setError("");
    openMaintenancePrintWindow({
      noDok: savedNoDok,
      codeTanki: form.codeTanki,
      description: form.description,
      reportedBy: form.reportedBy,
      priority: form.priority || null,
      technician: form.technician || null,
      scheduledDate: form.scheduledDate || null,
      start: form.start || null,
      finish: form.finish || null,
      remark: form.remark || null,
    });
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

  return (
    <div className="panel">
      <form className="panel-body" onSubmit={handleSubmit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: "0.85rem" }}>
            {savedNoDok ? (
              <>
                <strong>No Dok:</strong> {savedNoDok}
              </>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>No Dok dibuat otomatis begitu data ini disimpan.</span>
            )}
          </div>
          <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
            ↺ Reset Lebar Kolom
          </button>
        </div>
        <ExcelBlock title="Maintenance » Form Input Maintenance">
          {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
          <ExcelRow>
            <ExcelField label="Equipment Type" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")} {...gridNav("codeTanki")}>
              <input
                id="maintenance-code-tanki"
                value={form.codeTanki}
                onChange={(e) => setForm({ ...form, codeTanki: e.target.value })}
                placeholder="Mesin, Despa, Tanki, Listrik, etc"
                required
              />
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <label style={{ margin: 0 }}>Deskripsi Kerusakan</label>
            <button type="button" className="btn" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
              Upload Foto
            </button>
            {attachmentFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachmentFile.name}</span>}
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)} />
          </div>
          <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        </div>

        {error && <p className="error-text">{error}</p>}
        {message && <p className="status-text">{message}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-success" onClick={handlePrint}>
            🖨️ Print
          </button>
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
