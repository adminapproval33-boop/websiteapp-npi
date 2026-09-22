import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import Modal from "../../components/Modal";
import EmployeeNameSelect, { isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";

/**
 * Pop-up ringkas Form Input Maintenance (2026-09-22, instruksi eksplisit
 * user) -- dipicu langsung dari checkbox "Maintenance" di Tank/Mesin
 * Monitoring, TANPA pindah ke halaman /maintenance/form sama sekali (pola
 * sama dgn pop-up "Booking Tanki" di Info Proses Production Order
 * Monitoring). Field dibatasi ke yg paling relevan utk pencatatan cepat --
 * field lengkap (Tanggal Mulai/Selesai, Remark, lampiran foto) tetap bisa
 * dilengkapi belakangan lewat menu Maintenance > Form Input (List Job >
 * Edit), krn baris MaintenanceLog yg sama tetap tersimpan.
 */
export default function MaintenanceQuickModal({
  codeTanki,
  onClose,
  onSaved,
}: {
  codeTanki: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: employees } = useEmployeeOptions();
  const [noDok, setNoDok] = useState("");
  const [description, setDescription] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [reportedByNik, setReportedByNik] = useState<string | null>(null);
  const [priority, setPriority] = useState("");
  const [technician, setTechnician] = useState("");
  const [technicianNik, setTechnicianNik] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post("/maintenance", {
        codeTanki,
        noDok,
        description,
        reportedBy,
        reportedByNik,
        priority,
        technician,
        technicianNik,
        scheduledDate,
        start: "",
        finish: "",
        remark: "",
      }),
    onSuccess: () => onSaved(),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data Maintenance."),
  });

  function handleSave() {
    setError("");
    if (!description.trim()) {
      setError("Deskripsi wajib diisi.");
      return;
    }
    if (!reportedBy.trim()) {
      setError("Pelapor wajib diisi.");
      return;
    }
    if (!isKnownEmployeeName(employees, reportedBy)) {
      setError("Pelapor tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (technician.trim() && !isKnownEmployeeName(employees, technician)) {
      setError("Teknisi/PIC Maintenance tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    saveMutation.mutate();
  }

  return (
    <Modal title={`Maintenance — ${codeTanki}`} onClose={onClose} width={480} closeOnBackdropClick={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field">
          <label>No Dok</label>
          <input value={noDok} onChange={(e) => setNoDok(e.target.value)} />
        </div>
        <div className="field">
          <label>Deskripsi</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Pelapor</label>
          <EmployeeNameSelect
            bare
            id="maintenance-quick-reported-by"
            value={reportedBy}
            employeeId={reportedByNik}
            onChange={(v, nik) => {
              setReportedBy(v);
              setReportedByNik(nik ?? null);
            }}
            required
          />
        </div>
        <div className="field">
          <label>Prioritas</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">-</option>
            <option value="Normal">Normal</option>
            <option value="Urgent">Urgent</option>
          </select>
        </div>
        <div className="field">
          <label>Teknisi / PIC Maintenance</label>
          <EmployeeNameSelect
            bare
            id="maintenance-quick-technician"
            value={technician}
            employeeId={technicianNik}
            onChange={(v, nik) => {
              setTechnician(v);
              setTechnicianNik(nik ?? null);
            }}
          />
        </div>
        <div className="field">
          <label>Jadwal Pengerjaan</label>
          <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
        </div>

        {error && <p className="error-text">{error}</p>}
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
          Detail lengkap (Tanggal Mulai/Selesai, Remark, lampiran foto) bisa dilengkapi belakangan lewat menu
          Maintenance &gt; List Job &gt; Edit.
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn btn-success" disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
