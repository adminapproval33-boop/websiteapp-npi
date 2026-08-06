import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import { formatInputBy, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";
import { MAINTENANCE_STATUS_COLOR, MaintenanceHistoryRow } from "./types";

/**
 * "List Job Maintenance" (2026-08-06, instruksi eksplisit user) -- tabel
 * History dari Form Input Maintenance, status dihitung server-side (lihat
 * computeStatus di maintenance.routes.ts). Edit membuka halaman Form Input
 * Maintenance lewat query string `?editId=` (bukan tab spt modul lain, krn
 * ini 3 sub-menu terpisah).
 */
export default function MaintenanceListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const historyQuery = useQuery({
    queryKey: ["maintenance-history"],
    queryFn: () => api.get<{ success: boolean; data: MaintenanceHistoryRow[] }>("/maintenance/history").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/maintenance/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-history"] }),
  });

  const rows = (historyQuery.data ?? []).filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search.trim() && !r.codeTanki.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="panel">
      <div className="panel-header">List Job Maintenance</div>
      <div className="panel-body">
        <div className="field-grid" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Semua</option>
              <option value="Pending">Pending</option>
              <option value="Dijadwalkan">Dijadwalkan</option>
              <option value="Dikerjakan">Dikerjakan</option>
              <option value="Selesai">Selesai</option>
            </select>
          </div>
          <div className="field">
            <label>Cari Code Tanki</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari Code Tanki..." />
          </div>
        </div>

        <DataTable
          rowKey={(r: MaintenanceHistoryRow) => r.id}
          exportFileName="list-job-maintenance"
          storageKey="maintenance-history"
          rows={rows}
          emptyMessage="Belum ada Job Maintenance."
          columns={[
            {
              key: "timestamp",
              label: "Timestamp",
              render: (r) => formatDateTime(r.timestamp),
              csvValue: (r) => toExcelDateTimeString(r.timestamp),
            },
            { key: "codeTanki", label: "Code Tanki / Objek", render: (r) => r.codeTanki },
            { key: "description", label: "Deskripsi Kerusakan", render: (r) => r.description },
            { key: "priority", label: "Prioritas", render: (r) => r.priority ?? "-" },
            { key: "reportedBy", label: "Pelapor", render: (r) => r.reportedBy },
            { key: "technician", label: "Teknisi", render: (r) => r.technician ?? "-" },
            {
              key: "scheduledDate",
              label: "Jadwal Pengerjaan",
              render: (r) => (r.scheduledDate ? formatDateTime(r.scheduledDate) : "-"),
              csvValue: (r) => (r.scheduledDate ? toExcelDateTimeString(r.scheduledDate) : ""),
            },
            {
              key: "start",
              label: "Tanggal Mulai",
              render: (r) => (r.start ? formatDateTime(r.start) : "-"),
              csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
            },
            {
              key: "finish",
              label: "Tanggal Selesai",
              render: (r) => (r.finish ? formatDateTime(r.finish) : "-"),
              csvValue: (r) => (r.finish ? toExcelDateTimeString(r.finish) : ""),
            },
            {
              key: "status",
              label: "Status",
              render: (r) => <strong style={{ color: MAINTENANCE_STATUS_COLOR[r.status] }}>{r.status}</strong>,
              csvValue: (r) => r.status,
            },
            { key: "remark", label: "Remark", render: (r) => r.remark },
            { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
            { key: "attachments", label: "Lampiran", render: (r) => (r.attachments.length ? `${r.attachments.length} file` : "-") },
            {
              key: "actions",
              label: "Aksi",
              render: (r) => (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-outline"
                    type="button"
                    title="Edit"
                    aria-label="Edit"
                    style={{ padding: "6px 10px" }}
                    onClick={() => navigate(`/maintenance/form?editId=${r.id}`)}
                  >
                    ✏️
                  </button>
                  {getMenuLevel(user, "maintenance") === "INPUT" && (
                    <button
                      className="btn btn-danger"
                      type="button"
                      title="Hapus"
                      aria-label="Hapus"
                      style={{ padding: "6px 10px" }}
                      onClick={() => {
                        if (confirm(`Hapus Job Maintenance untuk ${r.codeTanki}?`)) deleteMutation.mutate(r.id);
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
  );
}
