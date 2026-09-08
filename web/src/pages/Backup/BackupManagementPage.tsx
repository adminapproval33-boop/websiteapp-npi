import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, backupDownloadUrl } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { formatDateTime } from "../../lib/datetime";

/** Restore & Hapus backup MENIMPA/MENGHILANGKAN data produksi secara permanen
 * -- dibatasi ke NIK ini saja (2026-09-08, instruksi eksplisit user), sama
 * daftar dgn ALLOWED_SYNC_NIKS di ApprovalPage.tsx (superadmin). Ini CUMA
 * menyembunyikan tombol -- validasi sesungguhnya ada di ALLOWED_BACKUP_ADMIN_NIKS
 * di backup.routes.ts, karena panggilan API langsung bisa melewati frontend. */
const ALLOWED_BACKUP_ADMIN_NIKS = ["000001", "019375", "001475", "012385", "019701"];

interface BackupFileRow {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

interface StorageInfo {
  disk: {
    backupDirTotalBytes: number;
    backupFileCount: number;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
  };
  blob: {
    totalBytes: number;
    fileCount: number;
    truncated: boolean;
  };
}

interface BackupSettingValue {
  autoBackupEnabled: boolean;
  autoBackupHour: number;
  retentionDays: number;
  retentionMaxCount: number;
}

interface BackupEventRow {
  id: number;
  action: "CREATE" | "AUTO_CREATE" | "RESTORE" | "DELETE" | "CLEANUP";
  fileName: string | null;
  byNik: string | null;
  note: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<BackupEventRow["action"], string> = {
  CREATE: "Buat Backup (Manual)",
  AUTO_CREATE: "Buat Backup (Otomatis)",
  RESTORE: "Restore Database",
  DELETE: "Hapus Backup",
  CLEANUP: "Bersihkan Retensi",
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** idx).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function UsageBar({ label, usedBytes, totalBytes }: { label: string; usedBytes: number; totalBytes: number | null }) {
  const pct = totalBytes ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: "var(--text-muted)" }}>
          {formatBytes(usedBytes)}
          {totalBytes ? ` / ${formatBytes(totalBytes)} (${pct}%)` : ""}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct ?? (usedBytes > 0 ? 100 : 0)}%`,
            background: pct !== null && pct >= 90 ? "#dc2626" : pct !== null && pct >= 70 ? "#d97706" : "#16a34a",
            transition: "width 0.2s ease",
          }}
        />
      </div>
    </div>
  );
}

export default function BackupManagementPage() {
  const { user } = useAuth();
  const isBackupAdmin = !!user && ALLOWED_BACKUP_ADMIN_NIKS.includes(user.nik);
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");

  const listQuery = useQuery({
    queryKey: ["backup-list"],
    queryFn: () => api.get<{ success: boolean; data: BackupFileRow[] }>("/backup/list").then((r) => r.data),
  });

  const storageQuery = useQuery({
    queryKey: ["backup-storage"],
    queryFn: () => api.get<{ success: boolean; data: StorageInfo }>("/backup/storage").then((r) => r.data),
  });

  const eventsQuery = useQuery({
    queryKey: ["backup-events"],
    queryFn: () => api.get<{ success: boolean; data: BackupEventRow[] }>("/backup/events").then((r) => r.data),
  });

  const settingsQuery = useQuery({
    queryKey: ["backup-settings"],
    queryFn: () => api.get<{ success: boolean; data: BackupSettingValue }>("/backup/settings").then((r) => r.data),
  });
  const [settingsForm, setSettingsForm] = useState<BackupSettingValue | null>(null);
  const settings = settingsForm ?? settingsQuery.data ?? null;

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["backup-list"] });
    queryClient.invalidateQueries({ queryKey: ["backup-storage"] });
    queryClient.invalidateQueries({ queryKey: ["backup-events"] });
  }

  const createMutation = useMutation({
    mutationFn: () => api.post("/backup/create", { label: label.trim() || undefined }),
    onSuccess: () => {
      setMessage("Backup berhasil dibuat.");
      setError("");
      setLabel("");
      invalidateAll();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Gagal membuat backup.");
      setMessage("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fileName: string) => api.delete(`/backup/${encodeURIComponent(fileName)}`),
    onSuccess: () => {
      setMessage("Backup berhasil dihapus.");
      setError("");
      invalidateAll();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus backup."),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>("/backup/cleanup"),
    onSuccess: (res) => {
      setMessage(res.message);
      setError("");
      invalidateAll();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menjalankan pembersihan."),
  });

  const restoreMutation = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; message: string }>(`/backup/restore/${encodeURIComponent(restoreTarget ?? "")}`, {
        confirmFileName: restoreConfirmText.trim(),
      }),
    onSuccess: (res) => {
      setMessage(res.message);
      setError("");
      setRestoreTarget(null);
      setRestoreConfirmText("");
      invalidateAll();
    },
    onError: (err) => setRestoreError(err instanceof ApiError ? err.message : "Gagal memulihkan database."),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: () => api.put("/backup/settings", settings),
    onSuccess: () => {
      setSettingsMessage("Pengaturan backup berhasil disimpan.");
      setSettingsError("");
      queryClient.invalidateQueries({ queryKey: ["backup-settings"] });
    },
    onError: (err) => setSettingsError(err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan."),
  });

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    createMutation.mutate();
  }

  function handleSettingsSubmit(e: FormEvent) {
    e.preventDefault();
    setSettingsMessage("");
    setSettingsError("");
    saveSettingsMutation.mutate();
  }

  const storage = storageQuery.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">Kontrol Storage</div>
        <div className="panel-body">
          {storageQuery.isLoading ? (
            <p>Memuat...</p>
          ) : storage ? (
            <>
              <UsageBar
                label={`Folder Backup (${storage.disk.backupFileCount} file)`}
                usedBytes={storage.disk.backupDirTotalBytes}
                totalBytes={storage.disk.diskTotalBytes}
              />
              <UsageBar
                label={`Lampiran (Vercel Blob, ${storage.blob.fileCount} file${storage.blob.truncated ? "+" : ""})`}
                usedBytes={storage.blob.totalBytes}
                totalBytes={null}
              />
              {storage.disk.diskFreeBytes !== null && (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                  Sisa ruang disk di drive backup: {formatBytes(storage.disk.diskFreeBytes)}.
                </p>
              )}
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                Semua file (backup database maupun lampiran upload) tersimpan permanen di sini atau di Vercel Blob --
                TIDAK ADA yang disimpan di penyimpanan sementara (temporary) server.
              </p>
              <button
                className="btn btn-outline"
                type="button"
                style={{ marginTop: 4 }}
                onClick={() => storageQuery.refetch()}
              >
                Refresh
              </button>
            </>
          ) : (
            <p className="error-text">Gagal memuat data storage.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Pengaturan Backup Otomatis &amp; Retensi</div>
        <div className="panel-body">
          {settingsQuery.isLoading || !settings ? (
            <p>Memuat...</p>
          ) : (
            <form onSubmit={handleSettingsSubmit}>
              <div className="field-grid">
                <div className="field">
                  <label>Backup Otomatis Harian</label>
                  <select
                    value={settings.autoBackupEnabled ? "on" : "off"}
                    onChange={(e) =>
                      setSettingsForm({ ...settings, autoBackupEnabled: e.target.value === "on" })
                    }
                  >
                    <option value="on">Aktif</option>
                    <option value="off">Nonaktif</option>
                  </select>
                </div>
                <div className="field">
                  <label>Jam Backup Otomatis (0-23)</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={settings.autoBackupHour}
                    onChange={(e) => setSettingsForm({ ...settings, autoBackupHour: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Retensi (hari, 0 = tanpa batas umur)</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.retentionDays}
                    onChange={(e) => setSettingsForm({ ...settings, retentionDays: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Maks. Jumlah File Backup (0 = tanpa batas)</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.retentionMaxCount}
                    onChange={(e) => setSettingsForm({ ...settings, retentionMaxCount: Number(e.target.value) })}
                  />
                </div>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                Backup yang melebihi batas umur ATAU jumlah di atas otomatis dihapus (yang paling lama duluan) --
                setiap kali ada backup baru, dan lewat tombol &quot;Bersihkan Sekarang&quot; di bawah.
              </p>
              {settingsError && <p className="error-text">{settingsError}</p>}
              {settingsMessage && <p className="status-text">{settingsMessage}</p>}
              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button className="btn btn-success" type="submit" disabled={saveSettingsMutation.isPending}>
                  Simpan Pengaturan
                </button>
                {isBackupAdmin && (
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={cleanupMutation.isPending}
                    onClick={() => {
                      setMessage("");
                      setError("");
                      cleanupMutation.mutate();
                    }}
                  >
                    Bersihkan Sekarang
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Backup Database</div>
        <div className="panel-body">
          <form onSubmit={handleCreateSubmit} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Label (opsional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. sebelum-training" />
            </div>
            <button className="btn btn-success" type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Membuat Backup..." : "Buat Backup Sekarang"}
            </button>
          </form>

          {error && <p className="error-text">{error}</p>}
          {message && <p className="status-text">{message}</p>}

          {listQuery.isLoading ? (
            <p>Memuat...</p>
          ) : (
            <DataTable
              rowKey={(r: BackupFileRow) => r.fileName}
              exportFileName="daftar-backup"
              storageKey="backup-management"
              rows={listQuery.data ?? []}
              freezeFirstColumn
              columns={[
                { key: "fileName", label: "Nama File", render: (r) => r.fileName },
                { key: "sizeBytes", label: "Ukuran", render: (r) => formatBytes(r.sizeBytes), csvValue: (r) => r.sizeBytes },
                { key: "createdAt", label: "Dibuat", render: (r) => formatDateTime(r.createdAt) },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <a className="btn btn-outline" href={backupDownloadUrl(r.fileName)} style={{ whiteSpace: "nowrap" }}>
                        Download
                      </a>
                      {isBackupAdmin && (
                        <>
                          <button
                            className="btn btn-outline"
                            type="button"
                            style={{ whiteSpace: "nowrap" }}
                            onClick={() => {
                              setRestoreTarget(r.fileName);
                              setRestoreConfirmText("");
                              setRestoreError("");
                            }}
                          >
                            Restore
                          </button>
                          <button
                            className="btn btn-danger"
                            type="button"
                            style={{ whiteSpace: "nowrap" }}
                            onClick={() => {
                              if (confirm(`Hapus file backup "${r.fileName}"? Tindakan ini tidak bisa dibatalkan.`)) {
                                setMessage("");
                                setError("");
                                deleteMutation.mutate(r.fileName);
                              }
                            }}
                          >
                            Hapus
                          </button>
                        </>
                      )}
                    </div>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Riwayat Aktivitas Backup</div>
        <div className="panel-body">
          {eventsQuery.isLoading ? (
            <p>Memuat...</p>
          ) : (
            <DataTable
              rowKey={(r: BackupEventRow) => r.id}
              exportFileName="riwayat-backup"
              storageKey="backup-events"
              rows={eventsQuery.data ?? []}
              columns={[
                { key: "createdAt", label: "Waktu", render: (r) => formatDateTime(r.createdAt) },
                { key: "action", label: "Aksi", render: (r) => ACTION_LABELS[r.action] },
                { key: "fileName", label: "File", render: (r) => r.fileName ?? "-" },
                { key: "byNik", label: "Oleh", render: (r) => r.byNik ?? "Sistem (otomatis)" },
                { key: "note", label: "Catatan", render: (r) => r.note ?? "-" },
              ]}
            />
          )}
        </div>
      </div>

      {restoreTarget && (
        <Modal title={`Restore Database dari "${restoreTarget}"`} onClose={() => setRestoreTarget(null)} width={560}>
          <p className="error-text" style={{ marginTop: 0 }}>
            PERINGATAN: aksi ini akan MENIMPA SELURUH data database saat ini dengan isi file backup di atas.
            Snapshot kondisi saat ini akan otomatis dibuat dulu sebagai jaring pengaman, tapi tetap lakukan di luar
            jam operasional dan pastikan tidak ada user lain yang sedang input data.
          </p>
          <div className="field">
            <label>Ketik ulang persis nama file untuk konfirmasi</label>
            <input value={restoreConfirmText} onChange={(e) => setRestoreConfirmText(e.target.value)} placeholder={restoreTarget} />
          </div>
          {restoreError && <p className="error-text">{restoreError}</p>}
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button
              className="btn btn-danger"
              type="button"
              disabled={restoreMutation.isPending || restoreConfirmText.trim() !== restoreTarget}
              onClick={() => {
                setRestoreError("");
                restoreMutation.mutate();
              }}
            >
              {restoreMutation.isPending ? "Memulihkan..." : "Restore Sekarang"}
            </button>
            <button className="btn btn-outline" type="button" onClick={() => setRestoreTarget(null)}>
              Batal
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
