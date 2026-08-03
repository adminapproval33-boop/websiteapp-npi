import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { formatDateTime } from "../../lib/datetime";

interface MesinOccupant {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  start: string | null;
  finish: string | null;
  since: string;
}

interface MesinRow {
  code: string;
  lokasi: string | null;
  status: "occupied" | "idle";
  occupant: MesinOccupant | null;
}

/** Dropdown Lokasi di form "+Code Mesin" (2026-08-02, instruksi eksplisit
 * user, dari screenshot revisi). UPPERCASE supaya konsisten dgn nilai Lokasi
 * yg sudah ada di DB (hasil import "list mesin.xlsx", semua "IU PLANT X") --
 * lihat juga normalisasi casing serupa di buildProduktivitasData
 * (dashboard.routes.ts) yg justru dibikin krn dulu ada campuran "IU Plant 1"
 * vs "IU PLANT 1" bikin baris pecah; dropdown ini mencegah masalah itu
 * terulang dari sisi input-nya langsung. */
const IU_PLANT_OPTIONS = ["IU PLANT 1", "IU PLANT 2", "IU PLANT 3", "IU PLANT 4", "IU PLANT 5", "IU PLANT 6"];

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

/**
 * Dashboard > Mesin Monitoring (2026-08-02, instruksi eksplisit user, versi
 * pertama -- daftar mesin dari file "list mesin.xlsx", status okupansi
 * diturunkan dari `codeMesin` di histori Milling, sama pola visual dgn
 * Dashboard > Tank Monitoring tapi disederhanakan krn sumbernya cuma 1 modul
 * (Milling), bukan lintas banyak modul spt Tank.
 */
export default function MesinDashboardPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // Tombol "+Code Mesin" / "-Code Mesin" (2026-08-02, instruksi eksplisit
  // user, dipindah dari Master Data ke sini supaya admin bisa tambah/hapus
  // mesin langsung dari halaman monitoring-nya) -- tambah/hapus 1 Code Mesin
  // tanpa perlu re-upload seluruh file "list mesin.xlsx".
  const [showAddMesin, setShowAddMesin] = useState(false);
  const [newMesinCode, setNewMesinCode] = useState("");
  const [newMesinLokasi, setNewMesinLokasi] = useState("");
  const [addMesinError, setAddMesinError] = useState("");
  const [showDeleteMesin, setShowDeleteMesin] = useState(false);
  const [deleteMesinCode, setDeleteMesinCode] = useState("");
  const [deleteMesinError, setDeleteMesinError] = useState("");
  // Tombol "Edit" di toolbar, sebelah kiri "+Code Mesin" (2026-08-02,
  // instruksi eksplisit user: dipakai SPV pas mesin dipindah lokasi/plant --
  // cuma Lokasi yg bisa diubah, Code Mesin-nya sendiri TETAP krn itu key
  // join ke histori Milling). Pilih Code Mesin dulu dari dropdown (sama pola
  // dgn "-Code Mesin"), Lokasi-nya otomatis keisi nilai sekarang.
  const [showEditMesin, setShowEditMesin] = useState(false);
  const [editMesinCode, setEditMesinCode] = useState("");
  const [editMesinLokasi, setEditMesinLokasi] = useState("");
  const [editMesinError, setEditMesinError] = useState("");

  const mesinQuery = useQuery({
    queryKey: ["dashboard-mesin-status"],
    queryFn: () => api.get<{ success: boolean; data: MesinRow[] }>(`/dashboard/mesin-status`).then((r) => r.data),
  });

  const addMesinMutation = useMutation({
    mutationFn: (payload: { code: string; lokasi: string }) => api.post<{ message: string }>("/master-data/mesin", payload),
    onSuccess: () => {
      setAddMesinError("");
      setShowAddMesin(false);
      setNewMesinCode("");
      setNewMesinLokasi("");
      queryClient.invalidateQueries({ queryKey: ["dashboard-mesin-status"] });
    },
    onError: (err) => setAddMesinError(err instanceof ApiError ? err.message : "Gagal menambah Code Mesin."),
  });

  const deleteMesinMutation = useMutation({
    mutationFn: (code: string) => api.delete<{ message: string }>(`/master-data/mesin/${encodeURIComponent(code)}`),
    onSuccess: () => {
      setDeleteMesinError("");
      setShowDeleteMesin(false);
      setDeleteMesinCode("");
      queryClient.invalidateQueries({ queryKey: ["dashboard-mesin-status"] });
    },
    onError: (err) => setDeleteMesinError(err instanceof ApiError ? err.message : "Gagal menghapus Code Mesin."),
  });

  const editMesinMutation = useMutation({
    mutationFn: (payload: { code: string; lokasi: string }) =>
      api.put<{ message: string }>(`/master-data/mesin/${encodeURIComponent(payload.code)}`, { lokasi: payload.lokasi }),
    onSuccess: () => {
      setEditMesinError("");
      setShowEditMesin(false);
      setEditMesinCode("");
      setEditMesinLokasi("");
      queryClient.invalidateQueries({ queryKey: ["dashboard-mesin-status"] });
    },
    onError: (err) => setEditMesinError(err instanceof ApiError ? err.message : "Gagal memperbarui Lokasi."),
  });

  const rows = mesinQuery.data ?? [];
  const occupiedCount = rows.filter((r) => r.status === "occupied").length;
  const idleCount = rows.length - occupiedCount;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const haystack = [r.code, r.lokasi, r.occupant?.order, r.occupant?.materialNumber, r.occupant?.materialDescription, r.occupant?.batch]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Total Mesin" value={rows.length} color="var(--navy-light)" />
        <KpiCard label="Mesin Idle" value={idleCount} color="var(--success)" />
        <KpiCard label="Mesin Terpakai" value={occupiedCount} color="var(--danger)" />
      </div>

      <div className="panel">
        <div className="panel-header">Mesin Monitoring</div>
        <div className="panel-body">
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Status "Terpakai"/"Idle" diturunkan otomatis dari Code Mesin yang diisi di menu Milling -- diambil dari
            input PALING TERAKHIR untuk tiap mesin, dan dianggap idle lagi begitu baris Milling tersebut sudah py
            Finish. Data ini bukan sensor fisik, jadi bisa saja tidak 100% akurat kalau ada tahap yang belum diinput
            ke sistem. Daftar mesinnya sendiri dari Master Data &gt; Master Data Mesin.
          </p>
          <input
            placeholder="Cari Code Mesin / Lokasi / Order / Material..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
          />
          <DataTable
            rowKey={(r: MesinRow) => r.code}
            exportFileName="mesin-monitoring"
            storageKey="mesin-monitoring"
            rows={filteredRows}
            freezeFirstColumn
            emptyMessage="Belum ada data mesin -- import lewat Master Data > Master Data Mesin."
            toolbarExtra={
              <>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setEditMesinCode("");
                    setEditMesinLokasi("");
                    setEditMesinError("");
                    setShowEditMesin(true);
                  }}
                >
                  ✏️ Edit
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setNewMesinCode("");
                    setNewMesinLokasi("");
                    setAddMesinError("");
                    setShowAddMesin(true);
                  }}
                >
                  +Code Mesin
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setDeleteMesinCode("");
                    setDeleteMesinError("");
                    setShowDeleteMesin(true);
                  }}
                >
                  -Code Mesin
                </button>
              </>
            }
            rowStyle={(r) => (r.status === "occupied" ? { background: "#fef2f2" } : undefined)}
            columns={[
              { key: "code", label: "Code Mesin", render: (r) => r.code },
              { key: "lokasi", label: "Lokasi", render: (r) => r.lokasi ?? "-" },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      background: r.status === "occupied" ? "#fbd6d6" : "#d4f4dd",
                      color: r.status === "occupied" ? "#991b1b" : "#065f46",
                    }}
                  >
                    {r.status === "occupied" ? "Terpakai" : "Idle"}
                  </span>
                ),
                csvValue: (r) => (r.status === "occupied" ? "Terpakai" : "Idle"),
              },
              { key: "order", label: "Order", render: (r) => r.occupant?.order ?? "-" },
              { key: "materialNumber", label: "Material Number", render: (r) => r.occupant?.materialNumber ?? "-" },
              { key: "materialDescription", label: "Material Description", render: (r) => r.occupant?.materialDescription ?? "-" },
              { key: "batch", label: "Batch", render: (r) => r.occupant?.batch ?? "-" },
              { key: "orderQty", label: "Qty/Liter", render: (r) => r.occupant?.orderQty ?? "-" },
              { key: "start", label: "Start", render: (r) => (r.occupant?.start ? formatDateTime(r.occupant.start) : "-") },
              { key: "finish", label: "Finish", render: (r) => (r.occupant?.finish ? formatDateTime(r.occupant.finish) : "-") },
            ]}
          />
        </div>
      </div>

      {showAddMesin && (
        <Modal title="+Code Mesin" onClose={() => setShowAddMesin(false)} width={420}>
          <div className="field-grid">
            <div className="field">
              <label>Code Mesin</label>
              <input value={newMesinCode} onChange={(e) => setNewMesinCode(e.target.value)} placeholder="mis. DYNO MILL 23" />
            </div>
            <div className="field">
              <label>Lokasi</label>
              <select value={newMesinLokasi} onChange={(e) => setNewMesinLokasi(e.target.value)}>
                <option value="">-- Pilih Lokasi --</option>
                {IU_PLANT_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {addMesinError && <p className="error-text">{addMesinError}</p>}
          <button
            className="btn"
            type="button"
            style={{ marginTop: 12 }}
            disabled={!newMesinCode.trim() || addMesinMutation.isPending}
            onClick={() => addMesinMutation.mutate({ code: newMesinCode.trim(), lokasi: newMesinLokasi.trim() })}
          >
            {addMesinMutation.isPending ? "Menyimpan..." : "Simpan"}
          </button>
        </Modal>
      )}

      {showDeleteMesin && (
        <Modal title="-Code Mesin" onClose={() => setShowDeleteMesin(false)} width={420}>
          <div className="field">
            <label>Pilih Code Mesin yang mau dihapus</label>
            <select value={deleteMesinCode} onChange={(e) => setDeleteMesinCode(e.target.value)}>
              <option value="">-- Pilih --</option>
              {rows.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} {m.lokasi ? `(${m.lokasi})` : ""}
                </option>
              ))}
            </select>
          </div>
          {deleteMesinError && <p className="error-text">{deleteMesinError}</p>}
          <button
            className="btn btn-danger"
            type="button"
            style={{ marginTop: 12 }}
            disabled={!deleteMesinCode || deleteMesinMutation.isPending}
            onClick={() => {
              if (confirm(`Hapus Code Mesin "${deleteMesinCode}"?`)) deleteMesinMutation.mutate(deleteMesinCode);
            }}
          >
            {deleteMesinMutation.isPending ? "Menghapus..." : "Hapus"}
          </button>
        </Modal>
      )}

      {showEditMesin && (
        <Modal title="Edit Lokasi Code Mesin" onClose={() => setShowEditMesin(false)} width={420}>
          <div className="field-grid">
            <div className="field">
              <label>Pilih Code Mesin</label>
              <select
                value={editMesinCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setEditMesinCode(code);
                  setEditMesinLokasi(rows.find((r) => r.code === code)?.lokasi ?? "");
                }}
              >
                <option value="">-- Pilih --</option>
                {rows.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} {m.lokasi ? `(${m.lokasi})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Lokasi Baru</label>
              <select value={editMesinLokasi} onChange={(e) => setEditMesinLokasi(e.target.value)} disabled={!editMesinCode}>
                <option value="">-- Pilih Lokasi --</option>
                {IU_PLANT_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {editMesinError && <p className="error-text">{editMesinError}</p>}
          <button
            className="btn"
            type="button"
            style={{ marginTop: 12 }}
            disabled={!editMesinCode || editMesinMutation.isPending}
            onClick={() => editMesinMutation.mutate({ code: editMesinCode, lokasi: editMesinLokasi })}
          >
            {editMesinMutation.isPending ? "Menyimpan..." : "Simpan"}
          </button>
        </Modal>
      )}
    </div>
  );
}
