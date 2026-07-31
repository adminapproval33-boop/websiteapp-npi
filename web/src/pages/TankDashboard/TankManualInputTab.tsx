import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect from "../../components/TankSelect";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";

interface TankManualRow {
  id: string;
  timestamp: string;
  codeTanki: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  remark: string | null;
  inputBy: string;
}

const emptyForm = {
  codeTanki: "",
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  remark: "",
};

export default function TankManualInputTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const listQuery = useQuery({
    queryKey: ["tank-manual-input"],
    queryFn: () => api.get<{ success: boolean; data: TankManualRow[] }>("/tank-manual-input").then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId ? api.put(`/tank-manual-input/${editingId}`, form) : api.post("/tank-manual-input", form),
    onSuccess: () => {
      setForm(emptyForm);
      setEditingId(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["tank-manual-input"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tank-manual-input/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tank-manual-input"] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  function startEdit(row: TankManualRow) {
    setEditingId(row.id);
    setForm({
      codeTanki: row.codeTanki,
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch ?? "",
      orderQty: row.orderQty ?? "",
      remark: row.remark ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      batch: data.batch ?? "",
      orderQty: data.orderQty ?? "",
    }));
  }

  const rows = listQuery.data ?? [];
  const filteredRows = search.trim()
    ? rows.filter((r) =>
        [r.codeTanki, r.order, r.materialNumber, r.materialDescription, r.batch]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      )
    : rows;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">{editingId ? "Edit Data Manual" : "Input Manual"}</div>
        <div className="panel-body">
          <p style={{ marginTop: 0, marginBottom: 12, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Catatan manual TERPISAH dari perhitungan otomatis "Monitoring Tanki" -- dipakai kalau ada Order yang
            menurut sistem sudah "Done"/"Teco" (jadi tidak lagi tercantum di tab Monitoring Tanki), tapi aktualnya
            produk itu masih ada di tanki. Input di sini supaya kondisi aktualnya tetap tercatat &amp; terlihat.
          </p>
          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              <TankSelect id="tank-manual-code" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
              <OrderLookup value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
              <div className="field">
                <label>Material Number</label>
                <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} />
              </div>
              <div className="field">
                <label>Material Description</label>
                <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
              </div>
              <div className="field">
                <label>Batch</label>
                <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} />
              </div>
              <div className="field">
                <label>Qty/Liter</label>
                <input value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Remark</label>
                <input
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  placeholder="Mis. alasan kenapa masih ada di tanki walau sistem sudah Done/Teco"
                />
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Tambah Data"}
              </button>
              {editingId && (
                <button className="btn btn-outline" type="button" onClick={cancelEdit}>
                  Batal
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Data Manual Saat Ini ({filteredRows.length} ditampilkan)</div>
        <div className="panel-body">
          <input
            placeholder="Cari Code Tanki / Order / Material..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
          />
          <DataTable
            rowKey={(r: TankManualRow) => r.id}
            exportFileName="tank-manual-input"
            storageKey="tank-manual-input"
            rows={filteredRows}
            freezeFirstColumn
            columns={[
              { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
              { key: "order", label: "Order", render: (r) => r.order },
              { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber ?? "-" },
              { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription ?? "-" },
              { key: "batch", label: "Batch", render: (r) => r.batch ?? "-" },
              { key: "orderQty", label: "Qty/Liter", render: (r) => r.orderQty ?? "-" },
              { key: "remark", label: "Remark", render: (r) => r.remark ?? "-" },
              {
                key: "timestamp",
                label: "Diinput",
                render: (r) => formatDateTime(r.timestamp),
                csvValue: (r) => toExcelDateTimeString(r.timestamp),
              },
              { key: "inputBy", label: "Input By", render: (r) => r.inputBy },
              {
                key: "actions",
                label: "Aksi",
                render: (r) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                      ✏️
                    </button>
                    {user?.access === "FULL_ACCESS" && (
                      <button
                        className="btn btn-danger"
                        type="button"
                        title="Hapus"
                        aria-label="Hapus"
                        style={{ padding: "6px 10px" }}
                        onClick={() => {
                          if (confirm(`Hapus data manual Code Tanki ${r.codeTanki} / Order ${r.order}?`)) deleteMutation.mutate(r.id);
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
    </div>
  );
}
