import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import DataTable from "../../components/DataTable";
import { formatDateDDMMYYYY, formatDateTime, parseDDMMYYYYToInputDate, toDateTimeLocalValue } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

/**
 * Stok Kepala Warna (Gudang Rak) -- 2026-11-13, instruksi eksplisit user:
 * adopsi logika macro VBA workbook "DATA KEPALA WARNA RAK 123.xlsm" ke web.
 * SATU form input saja (instruksi eksplisit user, revisi ke-2 -- versi
 * sebelumnya py toggle "Jenis Transaksi" di atas yg masih terlihat spt tab).
 * Semua field (Lot/Exp DAN No PO Proses/Mat Code Proses/Item Proses) SELALU
 * tampil bersamaan di 1 form yg sama -- jenis transaksi (Masuk/Keluar)
 * ditentukan lewat tombol SIMPAN mana yg diklik di bagian bawah ("Masukkan
 * ke Slot" / "Keluarkan dari Slot"), bukan toggle terpisah. Tab "Histori" =
 * sheet HIST IN OUT ZONA KEPALA WARNA, tab "Stok Rak" = sheet ZONA. Lookup
 * Batch/No PO reuse <OrderLookup> + `/master-data/orders/*` yg sudah ada
 * (sama sumber data `MasterOrder` dgn yg dulu disync macro `UPDMSTRNEW`),
 * BUKAN endpoint/tabel master baru.
 */

interface ZoneGroup {
  zonaGroup: string;
  kapasitas: number;
  terisi: number;
}

interface RackSlot {
  code: string;
  zonaGroup: string;
  occupied: boolean;
  currentBatch: string | null;
}

interface TransactionRow {
  id: number;
  type: "IN" | "OUT";
  rackCode: string;
  batch: string;
  materialNumber: string | null;
  materialDescription: string | null;
  noPo: string | null;
  lot: string | null;
  exp: string | null;
  qty: string | null;
  noPoProses: string | null;
  matCodeProses: string | null;
  itemProses: string | null;
  ket: string | null;
  inputBy: string;
  timestamp: string;
}

const emptyForm = {
  order: "",
  batch: "",
  rackCode: "",
  materialNumber: "",
  materialDescription: "",
  lot: "",
  exp: "",
  qty: "",
  ket: "",
  procOrder: "",
  matCodeProses: "",
  itemProses: "",
};

export default function KepalaWarnaPage() {
  const { user } = useAuth();
  const isViewOnly = getMenuLevel(user, "kepalaWarna") === "VIEW";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "histori" | "stok-rak">(isViewOnly ? "histori" : "input");

  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<{ message: string; payload: Record<string, unknown> } | null>(null);
  const [newSlotCode, setNewSlotCode] = useState("");
  const [histSearch, setHistSearch] = useState("");

  const zonesQuery = useQuery({
    queryKey: ["kw-zones"],
    queryFn: () => api.get<{ success: boolean; data: { slots: RackSlot[]; groups: ZoneGroup[] } }>("/kepala-warna/zones").then((r) => r.data),
  });

  const historyQuery = useQuery({
    queryKey: ["kw-transactions"],
    queryFn: () => api.get<{ success: boolean; data: TransactionRow[] }>("/kepala-warna/transactions").then((r) => r.data),
  });

  /// Fallback kalau Order belum pernah print label (lihat `autofillLotExp`
  /// di bawah) -- Lot/Exp/Zona disaran dari transaksi Masuk Kepala Warna
  /// terakhir utk Batch ini sendiri. `lot` dari situ sudah dlm format
  /// "dd-mm-yyyy" (sama konvensi `ProductionLabel.lotNo`, lihat saveMutation
  /// di bawah), jadi diparse balik ke "yyyy-mm-dd" utk <input type="date">.
  async function applyLatestIn(batch: string) {
    try {
      const res = await api.get<{ success: boolean; data: { lot: string | null; exp: string | null; rackCode: string } | null }>(
        `/kepala-warna/transactions/latest-in/${encodeURIComponent(batch)}`
      );
      if (res.data) {
        setForm((f) => ({
          ...f,
          lot: f.lot || parseDDMMYYYYToInputDate(res.data!.lot) || "",
          exp: f.exp || toDateTimeLocalValue(res.data!.exp).slice(0, 10),
          rackCode: f.rackCode || res.data!.rackCode || "",
        }));
      }
    } catch {
      /* belum pernah ada transaksi Masuk utk Batch ini -- biarkan kosong, diisi manual */
    }
  }

  /// Lot/Exp otomatis dari Label Entry (2026-11-13, instruksi eksplisit user)
  /// -- kalau Order ini SUDAH PERNAH print label (menu Label Entry SFG),
  /// pakai Lot No/Exp dari situ (sumber paling otoritatif, "label fisik yg
  /// sudah tercetak"). Kalau belum pernah, fallback ke histori Kepala Warna
  /// sendiri (`applyLatestIn`, keyed by Batch).
  async function autofillLotExp(order: string, batch: string | null) {
    try {
      const res = await api.get<{ success: boolean; data: { lotNo: string | null; exp: string | null } | null }>(
        `/kepala-warna/production-label/latest-by-order/${encodeURIComponent(order)}`
      );
      if (res.data) {
        setForm((f) => ({
          ...f,
          lot: parseDDMMYYYYToInputDate(res.data!.lotNo) || f.lot,
          exp: res.data!.exp ? toDateTimeLocalValue(res.data!.exp).slice(0, 10) : f.exp,
        }));
        return;
      }
    } catch {
      /* gagal/belum pernah print label -- lanjut fallback di bawah */
    }
    if (batch) applyLatestIn(batch);
  }

  function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      order: data.order,
      batch: data.batch ?? f.batch,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      // Order/Batch baru -- kosongkan dulu Lot/Exp lama sblm autofill ulang,
      // supaya tidak ada sisa data dari Order sebelumnya yg nyasar.
      lot: "",
      exp: "",
    }));
    autofillLotExp(data.order, data.batch ?? null);
  }

  const saveMutation = useMutation({
    mutationFn: ({ type, force }: { type: "IN" | "OUT"; force?: boolean }) =>
      api.post("/kepala-warna/transactions", {
        type,
        rackCode: form.rackCode,
        batch: form.batch,
        qty: form.qty,
        // Dikirim dlm format "dd-mm-yyyy" (sama konvensi `ProductionLabel.lotNo`)
        // -- `form.lot` sendiri "yyyy-mm-dd" (native <input type="date">).
        lot: type === "IN" ? formatDateDDMMYYYY(form.lot) || undefined : undefined,
        exp: type === "IN" ? form.exp || undefined : undefined,
        noPoProses: type === "OUT" ? form.procOrder || undefined : undefined,
        ket: form.ket,
        force,
      }),
    onSuccess: (_res, { type }) => {
      setMessage(type === "IN" ? "Berhasil dimasukkan ke slot." : "Berhasil dikeluarkan dari slot.");
      setError("");
      setConflict(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["kw-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["kw-zones"] });
    },
    onError: (err, { type }) => {
      if (type === "IN" && err instanceof ApiError && err.status === 409) {
        setConflict({
          message: err.message,
          payload: {
            type: "IN",
            rackCode: form.rackCode,
            batch: form.batch,
            qty: form.qty,
            lot: formatDateDDMMYYYY(form.lot) || undefined,
            exp: form.exp || undefined,
            ket: form.ket,
            force: true,
          },
        });
        return;
      }
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan transaksi.");
    },
  });

  const overrideMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/kepala-warna/transactions", payload),
    onSuccess: () => {
      setMessage("Berhasil dimasukkan ke slot (menimpa slot sebelumnya).");
      setError("");
      setConflict(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["kw-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["kw-zones"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan transaksi."),
  });

  const addSlotMutation = useMutation({
    mutationFn: () => api.post("/kepala-warna/zones", { code: newSlotCode }),
    onSuccess: () => {
      setNewSlotCode("");
      setMessage("Slot rak berhasil ditambahkan.");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["kw-zones"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menambahkan slot rak."),
  });

  function handleSubmit(e: FormEvent, type: "IN" | "OUT") {
    e.preventDefault();
    setMessage("");
    setError("");
    setConflict(null);
    if (!form.batch.trim()) {
      setError("Batch wajib diisi.");
      return;
    }
    if (!form.rackCode.trim()) {
      setError("Zona / Code Rak wajib diisi.");
      return;
    }
    if (!form.qty.trim()) {
      setError("Qty wajib diisi.");
      return;
    }
    saveMutation.mutate({ type });
  }

  const filteredHistory = (historyQuery.data ?? []).filter((row) =>
    histSearch.trim()
      ? `${row.batch} ${row.rackCode} ${row.materialDescription ?? ""} ${row.noPo ?? ""}`.toLowerCase().includes(histSearch.trim().toLowerCase())
      : true
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!isViewOnly && (
          <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
            Input
          </button>
        )}
        <button className={`btn ${tab === "histori" ? "" : "btn-outline"}`} onClick={() => setTab("histori")}>
          Histori
        </button>
        <button className={`btn ${tab === "stok-rak" ? "" : "btn-outline"}`} onClick={() => setTab("stok-rak")}>
          Stok Rak
        </button>
      </div>

      {message && <p className="status-text">{message}</p>}
      {error && <div className="error-text">{error}</div>}
      {conflict && (
        <div className="panel" style={{ padding: 12, background: "#fef3c7" }}>
          <p style={{ margin: 0 }}>{conflict.message}</p>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => overrideMutation.mutate(conflict.payload)}>
            Timpa Saja (Override)
          </button>
        </div>
      )}

      {tab === "input" && (
        <div className="panel">
          <form className="panel-body" onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <OrderLookup
              value={form.order}
              onChange={(v) => setForm((f) => ({ ...f, order: v }))}
              batchValue={form.batch}
              onBatchChange={(v) => setForm((f) => ({ ...f, batch: v }))}
              onFound={handleOrderFound}
              showBatchSearch
            />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label>Material Number</label>
                <input value={form.materialNumber} readOnly />
              </div>
              <div className="field" style={{ flex: "2 1 260px" }}>
                <label>Material Description</label>
                <input value={form.materialDescription} readOnly />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label title="Pilih dari daftar slot yg sudah terdaftar, atau ketik Code Rak baru kalau belum ada di daftar">Zona / Code Rak</label>
                <input
                  value={form.rackCode}
                  onChange={(e) => setForm((f) => ({ ...f, rackCode: e.target.value.toUpperCase() }))}
                  placeholder="mis. RAK.IU1.A.1"
                  list="kw-rack-slot-options"
                />
                <datalist id="kw-rack-slot-options">
                  {(zonesQuery.data?.slots ?? []).map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.occupied ? `Terisi: ${s.currentBatch}` : "Kosong"}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}>
                <label title="Diisi manual kalau Masukkan, otomatis tersaran dari transaksi Masuk terakhir kalau Keluarkan">Lot</label>
                <input type="date" value={form.lot} onChange={(e) => setForm((f) => ({ ...f, lot: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}>
                <label title="Diisi manual kalau Masukkan, otomatis tersaran dari transaksi Masuk terakhir kalau Keluarkan">Exp</label>
                <input type="date" value={form.exp} onChange={(e) => setForm((f) => ({ ...f, exp: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}>
                <label>Qty</label>
                <input value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label title="Khusus kalau mau Keluarkan -- tujuan pemakaian">No PO Proses</label>
                <OrderLookup
                  bare
                  value={form.procOrder}
                  onChange={(v) => setForm((f) => ({ ...f, procOrder: v }))}
                  onFound={(data) =>
                    setForm((f) => ({ ...f, matCodeProses: data.materialNumber ?? "", itemProses: data.materialDescription ?? "" }))
                  }
                  onNotFound={() => setForm((f) => ({ ...f, matCodeProses: "", itemProses: "" }))}
                />
              </div>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label>Mat Code Proses</label>
                <input value={form.matCodeProses} readOnly />
              </div>
              <div className="field" style={{ flex: "2 1 260px" }}>
                <label>Item Proses</label>
                <input value={form.itemProses} readOnly />
              </div>
            </div>

            <div className="field">
              <label>Ket</label>
              <input value={form.ket} onChange={(e) => setForm((f) => ({ ...f, ket: e.target.value }))} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                type="button"
                disabled={saveMutation.isPending}
                onClick={(e) => handleSubmit(e, "IN")}
                style={{ background: "var(--success)", borderColor: "var(--success)" }}
              >
                ⬇ Masukkan ke Slot
              </button>
              <button
                className="btn"
                type="button"
                disabled={saveMutation.isPending}
                onClick={(e) => handleSubmit(e, "OUT")}
                style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
              >
                ⬆ Keluarkan dari Slot
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "histori" && (
        <DataTable
          rowKey={(r: TransactionRow) => r.id}
          exportFileName="kepala-warna-histori"
          storageKey="kepala-warna-histori-v1"
          rows={filteredHistory}
          toolbarExtra={
            <input
              placeholder="Cari Batch / Code Rak / Nama Barang..."
              value={histSearch}
              onChange={(e) => setHistSearch(e.target.value)}
              style={{ padding: 8, width: 260, border: "1px solid var(--border)", borderRadius: 4 }}
            />
          }
          columns={[
            { key: "timestamp", label: "Tgl", render: (r) => formatDateTime(r.timestamp) },
            { key: "type", label: "Jenis", render: (r) => (r.type === "IN" ? "Masuk" : "Keluar"), csvValue: (r) => (r.type === "IN" ? "Masuk" : "Keluar") },
            { key: "rackCode", label: "Zona", render: (r) => r.rackCode },
            { key: "batch", label: "Batch", render: (r) => r.batch },
            { key: "noPo", label: "No PO", render: (r) => r.noPo ?? "-" },
            { key: "materialNumber", label: "Material Code", render: (r) => r.materialNumber ?? "-" },
            { key: "materialDescription", label: "Nama Barang", render: (r) => r.materialDescription ?? "-" },
            { key: "lot", label: "Lot", render: (r) => r.lot ?? "-" },
            { key: "exp", label: "Exp", render: (r) => (r.exp ? formatDateTime(r.exp) : "-") },
            { key: "qty", label: "Qty", render: (r) => r.qty ?? "-" },
            { key: "noPoProses", label: "No PO Proses", render: (r) => r.noPoProses ?? "-" },
            { key: "matCodeProses", label: "Mat Code Proses", render: (r) => r.matCodeProses ?? "-" },
            { key: "itemProses", label: "Item Proses", render: (r) => r.itemProses ?? "-" },
            { key: "ket", label: "Ket", render: (r) => r.ket ?? "-" },
            { key: "inputBy", label: "Input By", render: (r) => r.inputBy },
          ]}
        />
      )}

      {tab === "stok-rak" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!isViewOnly && (
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div className="field" style={{ flex: "0 0 240px" }}>
                  <label>+ Tambah Slot Rak Baru</label>
                  <input value={newSlotCode} onChange={(e) => setNewSlotCode(e.target.value.toUpperCase())} placeholder="mis. RAK.IU1.A.1" />
                </div>
                <button className="btn" type="button" disabled={!newSlotCode.trim()} onClick={() => addSlotMutation.mutate()}>
                  Tambah
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {(zonesQuery.data?.groups ?? []).map((g) => (
              <div key={g.zonaGroup} className="panel" style={{ padding: "10px 14px", minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>{g.zonaGroup}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Terisi {g.terisi} / {g.kapasitas}
                </div>
              </div>
            ))}
            {(zonesQuery.data?.groups ?? []).length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>Belum ada slot rak terdaftar. Tambahkan lewat form di atas.</p>
            )}
          </div>

          <DataTable
            rowKey={(r: RackSlot) => r.code}
            exportFileName="kepala-warna-stok-rak"
            storageKey="kepala-warna-stok-rak-v1"
            rows={zonesQuery.data?.slots ?? []}
            columns={[
              { key: "code", label: "Code Rak", render: (r) => r.code },
              { key: "zonaGroup", label: "Zona", render: (r) => r.zonaGroup },
              { key: "occupied", label: "Status", render: (r) => (r.occupied ? "Terisi" : "Kosong"), csvValue: (r) => (r.occupied ? "Terisi" : "Kosong") },
              { key: "currentBatch", label: "Batch Saat Ini", render: (r) => r.currentBatch ?? "-" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
