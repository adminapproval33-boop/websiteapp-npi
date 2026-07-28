import { FormEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";

interface SpecParameter {
  no: number;
  itemCheck: string;
  standardSpec: string;
  unit: string;
  remark: string;
}

interface SpecRow {
  specId: string;
  timestamp: string;
  materialNumber: string;
  materialDescription: string;
  information: string | null;
  inputBy: string;
  parameters: SpecParameter[];
}

function emptyParam(no: number): SpecParameter {
  return { no, itemCheck: "", standardSpec: "", unit: "", remark: "" };
}

/** Lebar kolom tabel yang bisa di-drag bebas oleh user (dipakai utk tabel
 * Material Number/Description & Spec Parameters -- 1 hook dipakai 2x). */
function useColResize(initial: number[]) {
  const [widths, setWidths] = useState<number[]>(initial);
  const dragRef = useRef<{ idx: number; startX: number; startWidth: number } | null>(null);

  function onMove(e: MouseEvent) {
    if (!dragRef.current) return;
    const { idx, startX, startWidth } = dragRef.current;
    const nextWidth = Math.max(40, startWidth + (e.clientX - startX));
    setWidths((w) => w.map((width, i) => (i === idx ? nextWidth : width)));
  }
  function onUp() {
    dragRef.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  function startResize(idx: number) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { idx, startX: e.clientX, startWidth: widths[idx] };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  return { widths, startResize };
}

/** Baris hasil "flatten": 1 baris tabel History = 1 parameter (bukan 1 spec dgn kolom
 * dinamis) -- ini format "tidy data" yang lebih mudah dianalisa di Excel (filter/sort/
 * pivot table konsisten), dan sekaligus meniru struktur Sheet "Product Spec Log" asli. */
interface FlatParamRow {
  specId: string;
  timestamp: string;
  materialNumber: string;
  materialDescription: string;
  inputBy: string;
  groupIndex: number;
  parameter: SpecParameter;
}

function flattenSpecs(specs: SpecRow[]): FlatParamRow[] {
  return specs.flatMap((spec, groupIndex) => {
    const params = spec.parameters.length > 0 ? spec.parameters : [emptyParam(1)];
    return params.map((parameter) => ({
      specId: spec.specId,
      timestamp: spec.timestamp,
      materialNumber: spec.materialNumber,
      materialDescription: spec.materialDescription,
      inputBy: spec.inputBy,
      groupIndex,
      parameter,
    }));
  });
}

const emptyForm = { materialNumber: "", materialDescription: "", information: "" };

export default function ProductSpekPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history">("input");
  const [form, setForm] = useState(emptyForm);
  const [params, setParams] = useState<SpecParameter[]>([emptyParam(1)]);
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [detailSpec, setDetailSpec] = useState<SpecRow | null>(null);
  const [showRemovePicker, setShowRemovePicker] = useState(false);

  // Lebar kolom "No / Item Check / Spec" & "Material Number / Description" bisa di-drag bebas oleh user (px).
  const { widths: specColWidths, startResize: startResizeSpecCol } = useColResize([60, 320, 180]);
  const { widths: headerColWidths, startResize: startResizeHeaderCol } = useColResize([280, 420]);

  const historyQuery = useQuery({
    queryKey: ["product-spec-history", search],
    queryFn: () => api.get<{ success: boolean; data: SpecRow[] }>(`/product-specs?search=${encodeURIComponent(search)}`).then((r) => r.data),
  });

  /** Dipakai khusus utk lookup Material Number di tab "Creating Product Spek" -- SENGAJA query
   * terpisah dari `historyQuery` (bukan reuse) supaya TIDAK ikut kefilter oleh kotak search
   * di tab History; field ini harus selalu bisa membaca SEMUA History Product Spek. */
  const allSpecsQuery = useQuery({
    queryKey: ["product-spec-history-all"],
    queryFn: () => api.get<{ success: boolean; data: SpecRow[] }>("/product-specs?search=").then((r) => r.data),
    staleTime: 30_000,
  });
  const allSpecs = allSpecsQuery.data ?? [];

  /** allSpecs sudah urut DESC by timestamp dari API -- match pertama = Spec TERBARU utk material ini. */
  function findHistoryForMaterial(matNo: string): SpecRow | undefined {
    const needle = matNo.trim().toLowerCase();
    if (!needle) return undefined;
    return allSpecs.find((r) => r.materialNumber.trim().toLowerCase() === needle);
  }

  /** Daftar saran (datalist) Material Number yang sudah pernah dibuat Spec-nya, dari History Product Spek. */
  const materialHistoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { materialNumber: string; materialDescription: string }[] = [];
    for (const r of allSpecs) {
      const key = r.materialNumber.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      options.push({ materialNumber: key, materialDescription: r.materialDescription });
    }
    return options;
  }, [allSpecs]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, parameters: params };
      return editingSpecId ? api.put(`/product-specs/${editingSpecId}`, payload) : api.post("/product-specs", payload);
    },
    onSuccess: () => {
      setMessage(editingSpecId ? "Data Spec berhasil diperbarui." : "Data Spec berhasil disimpan.");
      setError("");
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["product-spec-history"] });
      queryClient.invalidateQueries({ queryKey: ["product-spec-history-all"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (specId: string) => api.delete(`/product-specs/${specId}`),
    onSuccess: () => {
      setMessage("Data Spec berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["product-spec-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  async function lookupMaterial() {
    const matNo = form.materialNumber.trim();
    if (!matNo) return;

    let masterDescriptionFound = false;
    try {
      const res = await api.get<{ success: boolean; data: { materialDescription: string } }>(
        `/master-data/materials/${encodeURIComponent(matNo)}`
      );
      if (res.data.materialDescription) {
        setForm((f) => ({ ...f, materialDescription: res.data.materialDescription }));
        masterDescriptionFound = true;
      }
    } catch {
      /* material tidak ditemukan di referensi Master Data -- coba History Product Spek di bawah */
    }

    // Selain Master Data, sistem juga membaca History Product Spek: kalau Material Number ini
    // sudah pernah dibuat Spec-nya sebelumnya, tawarkan Spec Parameters & Information lama sbg
    // titik awal -- hanya kalau baris Spec Parameters MASIH KOSONG & bukan sedang mode Edit,
    // supaya tidak menimpa input yang sudah diketik user.
    if (editingSpecId) return;
    const existing = findHistoryForMaterial(matNo);
    if (!existing) return;

    if (!masterDescriptionFound && existing.materialDescription) {
      setForm((f) => ({ ...f, materialDescription: existing.materialDescription }));
    }

    const paramsAreEmpty = params.every((p) => !p.itemCheck.trim() && !p.standardSpec.trim());
    if (paramsAreEmpty && existing.parameters.length > 0) {
      setForm((f) => ({ ...f, information: existing.information ?? f.information }));
      setParams(
        existing.parameters.map((p) => ({
          no: p.no,
          itemCheck: p.itemCheck,
          standardSpec: p.standardSpec ?? "",
          unit: p.unit ?? "",
          remark: p.remark ?? "",
        }))
      );
      setMessage(
        `Material Number ini sudah pernah dibuat Spec-nya (${formatDateTime(existing.timestamp)}) — Spec Parameters otomatis diisi dari History Product Spek, silakan sesuaikan lalu Save.`
      );
    } else {
      setMessage(
        `Material Number ini sudah pernah dibuat Spec-nya sebelumnya (${formatDateTime(existing.timestamp)}) — cek tab History Product Spek kalau ingin menyalin Spec Parameters lama.`
      );
    }
    setError("");
  }

  function resetForm() {
    setForm(emptyForm);
    setParams([emptyParam(1)]);
    setEditingSpecId(null);
  }

  function startEdit(spec: SpecRow) {
    setEditingSpecId(spec.specId);
    setForm({ materialNumber: spec.materialNumber, materialDescription: spec.materialDescription, information: spec.information ?? "" });
    setParams(spec.parameters.map((p) => ({ no: p.no, itemCheck: p.itemCheck, standardSpec: p.standardSpec ?? "", unit: p.unit ?? "", remark: p.remark ?? "" })));
    setTab("input");
    setMessage("");
    setError("");
  }

  function updateParam(idx: number, patch: Partial<SpecParameter>) {
    setParams((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addParam() {
    setParams((rows) => [...rows, emptyParam(rows.length + 1)]);
  }
  function removeParam(idx: number) {
    setParams((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    saveMutation.mutate();
  }

  const historyRows = historyQuery.data ?? [];
  const flatRows = flattenSpecs(historyRows);
  const findSpec = (specId: string) => historyRows.find((s) => s.specId === specId)!;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
          {editingSpecId ? "Edit Spec" : "Creating Product Spek"}
        </button>
        <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "input" && (
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-header">{editingSpecId ? `Edit Spec — ${editingSpecId}` : "Creating Product Spek"}</div>
          <div className="panel-body">
            <div style={{ overflowX: "auto" }}>
              <table
                className="data-table"
                style={{ width: headerColWidths[0] + headerColWidths[1], tableLayout: "fixed" }}
              >
                <thead>
                  <tr>
                    {(["Material Number", "Material Description"] as const).map((label, idx) => (
                      <th key={label} style={{ width: headerColWidths[idx], position: "relative", userSelect: "none" }}>
                        {label}
                        <div
                          className="col-resize-handle"
                          onMouseDown={startResizeHeaderCol(idx)}
                          title="Drag utk ubah lebar kolom"
                          style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            height: "100%",
                            width: 6,
                            cursor: "col-resize",
                            touchAction: "none",
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ width: headerColWidths[0], overflow: "hidden" }}>
                      <input
                        list="pp-material-history-options"
                        value={form.materialNumber}
                        onChange={(e) => setForm({ ...form, materialNumber: e.target.value })}
                        onBlur={lookupMaterial}
                        required
                        style={{ width: "100%" }}
                      />
                      <datalist id="pp-material-history-options">
                        {materialHistoryOptions.map((m) => (
                          <option key={m.materialNumber} value={m.materialNumber}>
                            {m.materialDescription}
                          </option>
                        ))}
                      </datalist>
                    </td>
                    <td style={{ width: headerColWidths[1], overflow: "hidden" }}>
                      <input
                        value={form.materialDescription}
                        onChange={(e) => setForm({ ...form, materialDescription: e.target.value })}
                        required
                        style={{ width: "100%" }}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="pp-section-title" style={{ marginTop: 18 }}>
              Spec Parameters
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table
                className="data-table"
                style={{ width: specColWidths[0] + specColWidths[1] + specColWidths[2], tableLayout: "fixed" }}
              >
                <thead>
                  <tr>
                    {(["No", "Item Check", "Spec"] as const).map((label, idx) => (
                      <th key={label} style={{ width: specColWidths[idx], position: "relative", userSelect: "none" }}>
                        {label}
                        <div
                          className="col-resize-handle"
                          onMouseDown={startResizeSpecCol(idx)}
                          title="Drag utk ubah lebar kolom"
                          style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            height: "100%",
                            width: 6,
                            cursor: "col-resize",
                            touchAction: "none",
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {params.map((p, idx) => (
                    <tr key={idx}>
                      <td style={{ width: specColWidths[0], overflow: "hidden" }}>{p.no}</td>
                      <td style={{ width: specColWidths[1], overflow: "hidden" }}>
                        <input value={p.itemCheck} onChange={(e) => updateParam(idx, { itemCheck: e.target.value })} required style={{ width: "100%" }} />
                      </td>
                      <td style={{ width: specColWidths[2], overflow: "hidden" }}>
                        <input value={p.standardSpec} onChange={(e) => updateParam(idx, { standardSpec: e.target.value })} placeholder='mis. "40-45" atau "<=28"' style={{ width: "100%" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <button type="button" className="btn btn-info" onClick={addParam}>
                + Spec
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={params.length <= 1}
                title={params.length <= 1 ? "Minimal harus ada 1 Spec" : undefined}
                onClick={() => setShowRemovePicker(true)}
              >
                − Spec
              </button>
              <button className="btn" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Menyimpan..." : "Save"}
              </button>
              {editingSpecId && (
                <button type="button" className="btn btn-outline" onClick={resetForm}>
                  Batal Edit
                </button>
              )}
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Information</label>
              <textarea rows={6} value={form.information} onChange={(e) => setForm({ ...form, information: e.target.value })} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}
          </div>
        </form>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">History Product Spek</div>
          <div className="panel-body">
            <input
              placeholder="Cari Material Number / Description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              1 baris = 1 parameter (format tabel biasa/"tidy") supaya mudah difilter, di-sort,
              atau dibuatkan pivot table di Excel. Baris dgn warna sama = 1 Spec yang sama.
            </p>
            <DataTable
              rowKey={(r: FlatParamRow) => `${r.specId}-${r.parameter.no}`}
              exportFileName="history-product-spec"
              storageKey="product-spec-history"
              rows={flatRows}
              rowStyle={(r) => (r.groupIndex % 2 === 1 ? { background: "#f3f6fb" } : undefined)}
              columns={[
                {
                  key: "timestamp",
                  label: "Timestamp",
                  render: (r) => formatDateTime(r.timestamp),
                  csvValue: (r) => toExcelDateTimeString(r.timestamp),
                },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "no", label: "No", render: (r) => r.parameter.no },
                { key: "itemCheck", label: "Item Check", render: (r) => r.parameter.itemCheck },
                { key: "standardSpec", label: "Standard/Spec", render: (r) => r.parameter.standardSpec || "-" },
                { key: "inputBy", label: "Input By", render: (r) => r.inputBy },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-info"
                        type="button"
                        title="Detail"
                        aria-label="Detail"
                        style={{ padding: "6px 10px" }}
                        onClick={() => setDetailSpec(findSpec(r.specId))}
                      >
                        🔍
                      </button>
                      <button
                        className="btn btn-outline"
                        type="button"
                        title="Edit"
                        aria-label="Edit"
                        style={{ padding: "6px 10px" }}
                        onClick={() => startEdit(findSpec(r.specId))}
                      >
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
                            if (confirm(`Hapus Spec untuk ${r.materialDescription}?`)) deleteMutation.mutate(r.specId);
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
      )}

      {showRemovePicker && (
        <Modal title="Pilih Spec yang akan dihapus" onClose={() => setShowRemovePicker(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {params.map((p, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-outline"
                style={{ justifyContent: "space-between", width: "100%" }}
                onClick={() => {
                  removeParam(idx);
                  setShowRemovePicker(false);
                }}
              >
                <span>
                  No {p.no} — {p.itemCheck.trim() || "(Item Check belum diisi)"}
                </span>
                <span style={{ color: "var(--danger)", fontWeight: 700 }}>Hapus</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {detailSpec && (
        <Modal title={`Detail Spec — ${detailSpec.materialDescription}`} onClose={() => setDetailSpec(null)}>
          <div className="field-grid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Material Number</label>
              <input value={detailSpec.materialNumber} readOnly />
            </div>
            <div className="field">
              <label>Material Description</label>
              <input value={detailSpec.materialDescription} readOnly />
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>No</th>
                <th>Item Check</th>
                <th>Standard/Spec</th>
                <th>Unit</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {detailSpec.parameters.map((p) => (
                <tr key={p.no}>
                  <td>{p.no}</td>
                  <td>{p.itemCheck}</td>
                  <td>{p.standardSpec || "-"}</td>
                  <td>{p.unit || "-"}</td>
                  <td>{p.remark || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {detailSpec.information && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Information</label>
              <p style={{ margin: 0 }}>{detailSpec.information}</p>
            </div>
          )}

          <p style={{ marginTop: 14, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Dibuat {formatDateTime(detailSpec.timestamp)} oleh {detailSpec.inputBy}
          </p>
        </Modal>
      )}
    </div>
  );
}
