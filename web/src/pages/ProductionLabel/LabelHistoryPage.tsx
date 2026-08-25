import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { formatDateTime, formatDateDDMMYYYY, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel, MenuKey } from "../../lib/menuAccess";

interface LabelHistoryRow {
  id: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  lotNo: string | null;
  exp: string | null;
  shelfLife: string | null;
  codeTanki: string | null;
  iuPlant: string | null;
  pasteType: string | null;
  drumColour: string | null;
  /// Cuma ada di History Label Entry FG (kolom DB khusus ProductionLabelFg) -- undefined utk SFG.
  volume?: string | null;
  /// Cuma ada di History Label Entry FG (kolom DB khusus ProductionLabelFg) -- undefined utk SFG.
  jumlahPer?: string | null;
  /// Cuma ada di History Label Entry FG (kolom DB khusus ProductionLabelFg) -- undefined utk SFG.
  orderQtyPcs?: string | null;
  remark: string | null;
  printedBy: string;
}

interface EditField {
  key: string;
  label: string;
  type?: "date";
}

/** Label History (2026-08-04, instruksi eksplisit user) -- histori tiap kali
 * label produksi dicetak dari menu Label Entry SFG/FG (lihat
 * ProductionLabelEntryPage.tsx). Edit & Hapus (2026-08-25, instruksi eksplisit
 * user) dibuka utk level INPUT ke atas lewat getMenuLevel (BUKAN lagi
 * FULL_ACCESS-only) -- sama gerbang akses dgn Save di menu yang sama, jadi
 * user INPUT bisa perbaiki salah input atau hapus data siapa pun tanpa
 * batasan tambahan per-baris (lihat requireMenuInput di
 * productionLabel(Fg).routes.ts). */
export default function LabelHistoryPage({
  apiBase = "/production-label",
  showVolumeColumn = false,
  showJumlahPerColumn = false,
  showOrderQtyPcsColumn = false,
}: {
  apiBase?: string;
  /** Kolom "Volume" di tabel History (2026-08-20, instruksi eksplisit user)
   * -- KHUSUS Label Entry FG (kolom DB `volume` cuma ada di ProductionLabelFg),
   * default false (SFG tidak berubah). */
  showVolumeColumn?: boolean;
  /** Kolom "Jumlah /Per" di tabel History (2026-08-21, instruksi eksplisit
   * user) -- KHUSUS Label Entry FG (kolom DB `jumlahPer` cuma ada di
   * ProductionLabelFg), default false (SFG tidak berubah). */
  showJumlahPerColumn?: boolean;
  /** Kolom "Quantity/PCS" (varian Pcs) di tabel History (2026-08-21, instruksi
   * eksplisit user) -- KHUSUS Label Entry FG (kolom DB `orderQtyPcs` cuma ada
   * di ProductionLabelFg), default false (SFG tidak berubah). Varian /LITER-
   * nya (`orderQty`) SUDAH ada sbg kolom "Quantity/LITER" tanpa gerbang ini --
   * kolom itu memang sudah lama tampil di History SFG maupun FG. */
  showOrderQtyPcsColumn?: boolean;
} = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingRow, setEditingRow] = useState<LabelHistoryRow | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);

  const menuKey: MenuKey = apiBase === "/production-label-fg" ? "productionLabelFg" : "productionLabel";
  const canWrite = getMenuLevel(user, menuKey) === "INPUT";

  const historyQuery = useQuery({
    queryKey: ["production-label-history", apiBase],
    queryFn: () => api.get<{ success: boolean; data: LabelHistoryRow[] }>(`${apiBase}/history`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${apiBase}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-label-history", apiBase] }),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; body: Record<string, string> }) => api.put(`${apiBase}/${payload.id}`, payload.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-label-history", apiBase] });
      setEditingRow(null);
    },
    onError: (err) => setEditError(err instanceof ApiError ? err.message : "Gagal menyimpan perubahan."),
  });

  const editFields: EditField[] = [
    { key: "order", label: "Order" },
    { key: "materialNumber", label: "Material Number" },
    { key: "materialDescription", label: "Material Description" },
    { key: "batch", label: "Batch" },
    ...(showVolumeColumn ? [{ key: "volume", label: "Volume" }] : []),
    ...(showJumlahPerColumn ? [{ key: "jumlahPer", label: "Jumlah /Per" }] : []),
    { key: "orderQty", label: "Quantity/LITER" },
    ...(showOrderQtyPcsColumn ? [{ key: "orderQtyPcs", label: "Quantity/PCS" }] : []),
    { key: "plant", label: "Plant" },
    { key: "lotNo", label: "Lot No" },
    { key: "exp", label: "Exp", type: "date" },
    { key: "shelfLife", label: "Shelf Life" },
    { key: "codeTanki", label: "Code Tanki" },
    { key: "iuPlant", label: "IU Plant" },
    { key: "pasteType", label: "Material Type" },
    { key: "drumColour", label: "Drum Colour" },
    { key: "remark", label: "Remark" },
  ];

  function openEdit(row: LabelHistoryRow) {
    setEditError(null);
    setEditValues({
      order: row.order ?? "",
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch ?? "",
      orderQty: row.orderQty ?? "",
      orderQtyPcs: row.orderQtyPcs ?? "",
      plant: row.plant ?? "",
      lotNo: row.lotNo ?? "",
      exp: row.exp ? row.exp.slice(0, 10) : "",
      shelfLife: row.shelfLife ?? "",
      codeTanki: row.codeTanki ?? "",
      iuPlant: row.iuPlant ?? "",
      pasteType: row.pasteType ?? "",
      drumColour: row.drumColour ?? "",
      volume: row.volume ?? "",
      jumlahPer: row.jumlahPer ?? "",
      remark: row.remark ?? "",
    });
    setEditingRow(row);
  }

  function submitEdit() {
    if (!editingRow) return;
    setEditError(null);
    updateMutation.mutate({ id: editingRow.id, body: editValues });
  }

  const filtered = (historyQuery.data ?? []).filter((row) =>
    search.trim() ? row.order.toLowerCase().includes(search.trim().toLowerCase()) : true
  );

  return (
    <div className="panel">
      <div className="panel-header">Label History</div>
      <div className="panel-body">
        <input
          placeholder="Cari nomor Order..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
        />
        <DataTable
          rowKey={(r: LabelHistoryRow) => r.id}
          exportFileName="label-history"
          storageKey="label-history"
          rows={filtered}
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
            ...(showVolumeColumn ? [{ key: "volume", label: "Volume", render: (r: LabelHistoryRow) => r.volume ?? null }] : []),
            ...(showJumlahPerColumn ? [{ key: "jumlahPer", label: "Jumlah /Per", render: (r: LabelHistoryRow) => r.jumlahPer ?? null }] : []),
            { key: "orderQty", label: "Quantity/LITER", render: (r) => r.orderQty },
            ...(showOrderQtyPcsColumn
              ? [{ key: "orderQtyPcs", label: "Quantity/PCS", render: (r: LabelHistoryRow) => r.orderQtyPcs ?? null }]
              : []),
            { key: "plant", label: "Plant", render: (r) => r.plant },
            { key: "lotNo", label: "Lot No", render: (r) => r.lotNo },
            {
              key: "exp",
              label: "Exp",
              render: (r) => (r.exp ? formatDateDDMMYYYY(r.exp) : "-"),
              csvValue: (r) => (r.exp ? toExcelDateTimeString(r.exp) : ""),
            },
            { key: "shelfLife", label: "Shelf Life", render: (r) => r.shelfLife },
            { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
            { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
            { key: "pasteType", label: "Material Type", render: (r) => r.pasteType },
            { key: "drumColour", label: "Drum Colour", render: (r) => r.drumColour },
            { key: "remark", label: "Remark", render: (r) => r.remark },
            { key: "printedBy", label: "Printed By", render: (r) => r.printedBy },
            {
              key: "actions",
              label: "Aksi",
              render: (r) =>
                canWrite ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn btn-outline"
                      type="button"
                      title="Edit"
                      aria-label="Edit"
                      style={{ padding: "6px 10px" }}
                      onClick={() => openEdit(r)}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-danger"
                      type="button"
                      title="Hapus"
                      aria-label="Hapus"
                      style={{ padding: "6px 10px" }}
                      onClick={() => {
                        if (confirm(`Hapus riwayat Label untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ) : null,
              csvValue: () => "",
            },
          ]}
        />
      </div>

      {editingRow && (
        <Modal title={`Edit Label History - Order ${editingRow.order}`} onClose={() => setEditingRow(null)} width={600}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {editError && <div style={{ color: "var(--danger, #dc2626)" }}>{editError}</div>}
            {editFields.map((field) => (
              <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
                {field.label}
                <input
                  type={field.type ?? "text"}
                  value={editValues[field.key] ?? ""}
                  onChange={(e) => setEditValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 4 }}
                />
              </label>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button className="btn btn-outline" type="button" onClick={() => setEditingRow(null)}>
                Batal
              </button>
              <button className="btn" type="button" disabled={updateMutation.isPending} onClick={submitEdit}>
                {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
