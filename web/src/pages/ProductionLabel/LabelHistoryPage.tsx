import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import { formatDateTime, formatDateDDMMYYYY, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";

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
  remark: string | null;
  printedBy: string;
}

/** Label History (2026-08-04, instruksi eksplisit user) -- histori tiap kali
 * label produksi dicetak dari Production Label Entry (lihat
 * ProductionLabelEntryPage.tsx). Hapus dibatasi FULL_ACCESS -- menu ini
 * BUKAN bagian sistem akses per-menu View/Input/Hide (lib/menuAccess.ts),
 * sama spt Tank Manual Input/Production Order Manual Input, jadi pola
 * hapusnya ikut default lama (FULL_ACCESS saja), bukan getMenuLevel. */
export default function LabelHistoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const historyQuery = useQuery({
    queryKey: ["production-label-history"],
    queryFn: () => api.get<{ success: boolean; data: LabelHistoryRow[] }>("/production-label/history").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/production-label/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-label-history"] }),
  });

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
            { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
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
                user?.access === "FULL_ACCESS" ? (
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
                ) : null,
              csvValue: () => "",
            },
          ]}
        />
      </div>
    </div>
  );
}
