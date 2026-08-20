import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import DataTable from "../../components/DataTable";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import EmployeeNameSelect, {
  formatInputBy,
  isKnownEmployeeName,
  useEmployeeOptions,
  useNameSuggestions,
  normalizeMembers,
  MemberEntry,
} from "../../components/EmployeeNameSelect";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import MaterialFlowPanel from "./MaterialFlowPanel";

interface ManualRow {
  id: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  start: string | null;
  finish: string | null;
  spvProduksi: string;
  spvProduksiNik: string | null;
  leader: string | null;
  leaderNik: string | null;
  members: (string | MemberEntry)[] | null;
  inputBy: string;
}

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  codeTanki: "",
  start: "",
  finish: "",
  spvProduksi: "",
  spvProduksiNik: null as string | null,
  leader: "",
  leaderNik: null as string | null,
  members: [] as MemberEntry[],
};

export default function ManualInputModal() {
  const { user } = useAuth();
  // Edit/Hapus (2026-08-20, instruksi eksplisit user) -- sebelumnya cuma
  // FULL_ACCESS, sekarang user dgn akses Input juga boleh, HANYA akses View
  // (baca-saja) yg tetap tidak bisa -- sama pola dgn requireWrite di
  // backend (lihat productionOrderManualInput.routes.ts PUT/DELETE).
  const canEditOrDelete = user?.access === "FULL_ACCESS" || user?.access === "INPUT";
  const queryClient = useQueryClient();
  const { data: employees } = useEmployeeOptions();
  const { data: spvSuggestions } = useNameSuggestions("productionOrderManualInput", "spv");
  const { data: leaderSuggestions } = useNameSuggestions("productionOrderManualInput", "leader");
  const { data: memberSuggestions } = useNameSuggestions("productionOrderManualInput", "member");
  const { data: tanks } = useTankOptions();

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memberNameInput, setMemberNameInput] = useState("");
  const [memberNikInput, setMemberNikInput] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const listQuery = useQuery({
    queryKey: ["production-order-manual-input"],
    queryFn: () => api.get<{ success: boolean; data: ManualRow[] }>("/production-order-manual-input").then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? api.put(`/production-order-manual-input/${editingId}`, form)
        : api.post("/production-order-manual-input", form),
    onSuccess: () => {
      setForm(emptyForm);
      setEditingId(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["production-order-manual-input"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/production-order-manual-input/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-order-manual-input"] }),
  });

  /** Order ditemukan di Referensi Order/PO (SAP-COOISPI) -- Description, Qty,
   * Plant otomatis diisi dari Master Data (2026-08-03, instruksi eksplisit
   * user). Kalau Order yang diketik TIDAK ada di Master Data (mis. "Form E"),
   * OrderLookup tidak memanggil callback ini sama sekali, jadi 3 kolom ini
   * tetap kosong/apa adanya utk diisi manual oleh admin. */
  function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      materialDescription: data.materialDescription ?? "",
      orderQty: data.orderQty ?? "",
      plant: data.plant ?? "",
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isKnownEmployeeName(employees, form.spvProduksi) || !isKnownEmployeeName(employees, form.leader)) {
      setError("SPV Produksi/Leader harus dipilih dari Data Karyawan.");
      return;
    }
    if (!isKnownTankCode(tanks, form.codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    setError("");
    saveMutation.mutate();
  }

  function startEdit(row: ManualRow) {
    setEditingId(row.id);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      codeTanki: row.codeTanki ?? "",
      start: toDateTimeLocalValue(row.start),
      finish: toDateTimeLocalValue(row.finish),
      spvProduksi: row.spvProduksi,
      spvProduksiNik: row.spvProduksiNik ?? null,
      leader: row.leader ?? "",
      leaderNik: row.leaderNik ?? null,
      members: normalizeMembers(row.members),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function addMember() {
    const name = memberNameInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    setError("");
    setForm((f) => ({ ...f, members: [...f.members, { name, nik: memberNikInput }] }));
    setMemberNameInput("");
    setMemberNikInput(null);
  }

  function removeMember(idx: number) {
    setForm((f) => ({ ...f, members: f.members.filter((_, i) => i !== idx) }));
  }

  const rows = listQuery.data ?? [];
  const filteredRows = search.trim()
    ? rows.filter((r) =>
        [r.order, r.materialNumber, r.materialDescription, r.spvProduksi]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      )
    : rows;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ marginTop: 0, marginBottom: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Catatan manual TERPISAH dari perhitungan otomatis tabel Production Order Monitoring -- dipakai kalau ada Order
        yang datanya belum/tidak lengkap secara otomatis. Isi Material Number dulu untuk mengatur tahap wajib
        Material tersebut (opsional), lalu lengkapi data Order di bawah.
      </p>

      <div className="field" style={{ maxWidth: 320 }}>
        <label>Material Number</label>
        <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} />
      </div>

      {form.materialNumber.trim() && <MaterialFlowPanel materialNumber={form.materialNumber.trim()} stages={[]} />}

      <div className="panel">
        <div className="panel-header">{editingId ? "Edit Data Manual" : "Input Manual"}</div>
        <div className="panel-body">
          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              <OrderLookup value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
              <div className="field">
                <label>Description</label>
                <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
              </div>
              <div className="field">
                <label>Qty</label>
                <input value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} />
              </div>
              <div className="field">
                <label>Plant</label>
                <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} />
              </div>
              <IuPlantSelect id="po-manual-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} />
              <TankSelect id="po-manual-tank" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} required={false} />
              <div className="field">
                <label>Start</label>
                <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </div>
              <div className="field">
                <label>Finish</label>
                <input type="datetime-local" value={form.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} />
              </div>
              <EmployeeNameSelect
                id="po-manual-spv"
                label="SPV Produksi"
                value={form.spvProduksi}
                employeeId={form.spvProduksiNik}
                onChange={(v, nik) => setForm({ ...form, spvProduksi: v, spvProduksiNik: nik ?? null })}
                suggestions={spvSuggestions}
                required
              />
              <EmployeeNameSelect
                id="po-manual-leader"
                label="Leader"
                value={form.leader}
                employeeId={form.leaderNik}
                onChange={(v, nik) => setForm({ ...form, leader: v, leaderNik: nik ?? null })}
                suggestions={leaderSuggestions}
              />
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Member</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <EmployeeNameSelect
                      bare
                      id="po-manual-member"
                      value={memberNameInput}
                      employeeId={memberNikInput}
                      onChange={(v, nik) => {
                        setMemberNameInput(v);
                        setMemberNikInput(nik ?? null);
                      }}
                      suggestions={memberSuggestions}
                    />
                  </div>
                  <button type="button" className="btn btn-outline" onClick={addMember}>
                    + Tambah
                  </button>
                </div>
                {form.members.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {form.members.map((m, idx) => (
                      <span key={`${m.name}-${idx}`} className="excel-member-chip">
                        {m.name}
                        <button
                          type="button"
                          onClick={() => removeMember(idx)}
                          style={{ border: 0, background: "transparent", cursor: "pointer", fontWeight: 700 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
            placeholder="Cari Order / Material / SPV..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
          />
          <DataTable
            rowKey={(r: ManualRow) => r.id}
            exportFileName="production-order-manual-input"
            storageKey="production-order-manual-input"
            rows={filteredRows}
            freezeFirstColumn
            columns={[
              { key: "order", label: "Order", render: (r) => r.order },
              { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber ?? "-" },
              { key: "materialDescription", label: "Description", render: (r) => r.materialDescription ?? "-" },
              { key: "orderQty", label: "Qty", render: (r) => r.orderQty ?? "-" },
              { key: "plant", label: "Plant", render: (r) => r.plant ?? "-" },
              { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant ?? "-" },
              { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki ?? "-" },
              {
                key: "start",
                label: "Start",
                render: (r) => formatDateTime(r.start),
                csvValue: (r) => toExcelDateTimeString(r.start),
              },
              {
                key: "finish",
                label: "Finish",
                render: (r) => formatDateTime(r.finish),
                csvValue: (r) => toExcelDateTimeString(r.finish),
              },
              { key: "spvProduksi", label: "SPV Produksi", render: (r) => r.spvProduksi },
              { key: "leader", label: "Leader", render: (r) => r.leader ?? "-" },
              {
                key: "members",
                label: "Member",
                render: (r) => normalizeMembers(r.members).map((m) => m.name).join(", ") || "-",
                csvValue: (r) => normalizeMembers(r.members).map((m) => m.name).join(", "),
              },
              { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
              ...(canEditOrDelete
                ? [
                    {
                      key: "actions",
                      label: "Aksi",
                      render: (r: ManualRow) => (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                            ✏️
                          </button>
                          <button
                            className="btn btn-danger"
                            type="button"
                            title="Hapus"
                            aria-label="Hapus"
                            style={{ padding: "6px 10px" }}
                            onClick={() => {
                              if (confirm(`Hapus data manual Order ${r.order}?`)) deleteMutation.mutate(r.id);
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                      ),
                      csvValue: () => "",
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
    </div>
  );
}
