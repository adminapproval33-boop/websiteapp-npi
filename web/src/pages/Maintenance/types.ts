/** Menu "Maintenance" (2026-08-06, instruksi eksplisit user) -- tipe bersama
 * dipakai 3 halaman (Form Input, List Job, Jadwal Pengerjaan) krn semuanya
 * beroperasi di 1 sumber data yg sama (MaintenanceLog), cuma tampilan beda. */

export type MaintenanceStatus = "Pending" | "Dijadwalkan" | "Dikerjakan" | "Selesai";

export interface MaintenanceAttachment {
  id: number;
  fileName: string;
  filePath: string;
}

export interface MaintenanceRow {
  id: number;
  timestamp: string;
  codeTanki: string;
  description: string;
  reportedBy: string;
  reportedByNik: string | null;
  priority: string | null;
  technician: string | null;
  technicianNik: string | null;
  scheduledDate: string | null;
  sequence: number;
  start: string | null;
  finish: string | null;
  remark: string | null;
  inputBy: string;
  status: MaintenanceStatus;
}

export interface MaintenanceHistoryRow extends MaintenanceRow {
  attachments: MaintenanceAttachment[];
}

export const MAINTENANCE_STATUS_COLOR: Record<MaintenanceStatus, string> = {
  Pending: "var(--text-muted)",
  Dijadwalkan: "#d97706",
  Dikerjakan: "#2563eb",
  Selesai: "var(--success)",
};

export const emptyMaintenanceForm = {
  codeTanki: "",
  description: "",
  reportedBy: "",
  reportedByNik: null as string | null,
  priority: "",
  technician: "",
  technicianNik: null as string | null,
  scheduledDate: "",
  start: "",
  finish: "",
  remark: "",
};

export type MaintenanceForm = typeof emptyMaintenanceForm;
