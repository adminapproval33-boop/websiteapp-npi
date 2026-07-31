import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

interface MaterialFlowRow {
  materialNumber: string;
  materialDescription: string | null;
  premixRequired: boolean;
  millingRequired: boolean;
  aftermixRequired: boolean;
  colourMatchingRequired: boolean;
  qcRequired: boolean;
  approvalRequired: boolean;
  packingRequired: boolean;
}

type FlowField =
  | "premixRequired"
  | "millingRequired"
  | "aftermixRequired"
  | "colourMatchingRequired"
  | "qcRequired"
  | "approvalRequired"
  | "packingRequired";

/** QC & Packing SENGAJA tidak bisa dilepas centangnya di sini -- wajib
 * mutlak utk SEMUA Material, tidak ada pengecualian (instruksi eksplisit
 * user, 2026-07-31, lihat lib/stageGate.ts di server). */
const STAGE_ROWS: { name: string; field: FlowField; mandatory?: boolean }[] = [
  { name: "Premix", field: "premixRequired" },
  { name: "Milling", field: "millingRequired" },
  { name: "Aftermix", field: "aftermixRequired" },
  { name: "Colour Matching", field: "colourMatchingRequired" },
  { name: "QC", field: "qcRequired", mandatory: true },
  { name: "Approval", field: "approvalRequired" },
  { name: "Packing", field: "packingRequired", mandatory: true },
];

/**
 * Panel "Info Proses Material" di pop-up "Tahap Selanjutnya" Production
 * Order Monitoring (2026-07-31, instruksi eksplisit user) -- menampilkan
 * label tahap (sama isinya dgn Proses Bar) + status Selesai/Belum per Order
 * ybs, DITAMBAH kolom edit "Wajib?" yg terkoneksi langsung ke Master Data
 * Material Flow Proses (server/src/lib/stageGate.ts pakai tabel yg sama utk
 * penguncian urutan tahap seluruh sistem -- jadi perubahan di sini
 * berdampak ke SEMUA Order dgn Material Number yg sama, bukan cuma Order
 * ini).
 */
export default function MaterialFlowPanel({
  materialNumber,
  stages,
  onFlowSaved,
  onOpenStage,
}: {
  materialNumber: string | null;
  /** Dari `r.stages` baris Dashboard -- HANYA berisi tahap yg SAAT INI
   * wajib (hasil MaterialFlow terkini), dipakai utk status Selesai/Belum. */
  stages: { name: string; done: boolean }[];
  /** Dipanggil setelah edit "Wajib?" berhasil disimpan -- dipakai pemanggil
   * utk refresh data Dashboard (Proses Bar bisa berubah). */
  onFlowSaved?: () => void;
  /** Tombol per-baris (2026-07-31, instruksi eksplisit user) -- klik ->
   * form Input di bawah panel ini langsung ganti ke tahap tsb, TANPA nutup
   * pop-up. Dipakai utk pindah-pindah antar tahap dari 1 pop-up yg sama. */
  onOpenStage?: (stageName: string) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.access === "FULL_ACCESS";
  const [checked, setChecked] = useState<Record<FlowField, boolean> | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const flowQuery = useQuery({
    queryKey: ["material-flow-single", materialNumber],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MaterialFlowRow | null }>(`/master-data/material-flow/${encodeURIComponent(materialNumber!)}`)
        .then((r) => r.data),
    enabled: !!materialNumber,
  });

  useEffect(() => {
    const flow = flowQuery.data;
    setChecked({
      premixRequired: flow?.premixRequired ?? false,
      millingRequired: flow?.millingRequired ?? false,
      aftermixRequired: flow?.aftermixRequired ?? false,
      colourMatchingRequired: flow?.colourMatchingRequired ?? false,
      qcRequired: true,
      approvalRequired: flow?.approvalRequired ?? false,
      packingRequired: true,
    });
    setMessage("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowQuery.data, materialNumber]);

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/master-data/material-flow/${encodeURIComponent(materialNumber!)}`, checked),
    onSuccess: () => {
      setMessage("Material Flow berhasil diperbarui.");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["material-flow-single", materialNumber] });
      onFlowSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan Material Flow."),
  });

  const statusByName = new Map(stages.map((s) => [s.name, s.done]));

  /** Cek urutan sebelum benar2 buka pop-up tahap X (2026-07-31, instruksi
   * eksplisit user): kalau ADA tahap SEBELUM X (di urutan Proses Bar, `stages`
   * -- sudah terurut Premix->Milling->...->Packing) yg belum "done", tolak &
   * kasih tahu tahap mana yg harus diinput dulu -- BUKAN langsung buka form
   * lalu baru gagal pas Save (gerbang aslinya tetap di backend, lib/
   * stageGate.ts -- ini cuma kasih tahu di awal drpd bikin admin isi form
   * dulu baru ketahuan ditolak). Tahap yg TIDAK WAJIB (tidak ada di `stages`)
   * dibiarkan lewat -- bukan bagian urutan resmi Material ini. */
  function findBlockingStage(stageName: string): string | null {
    const idx = stages.findIndex((s) => s.name === stageName);
    if (idx <= 0) return null;
    const blocking = stages.slice(0, idx).find((s) => !s.done);
    return blocking?.name ?? null;
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        Info Proses Material{materialNumber ? ` — ${materialNumber}` : ""}
      </div>
      <div className="panel-body">
        {!materialNumber && <p style={{ color: "var(--text-muted)" }}>Material Number Order ini belum diketahui.</p>}
        {materialNumber && flowQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
        {materialNumber && !flowQuery.isLoading && !flowQuery.data && (
          <p style={{ color: "var(--warning, #b7791f)", marginTop: 0, marginBottom: 12, fontSize: "0.85rem" }}>
            Material ini belum terdaftar di Master Data &gt; Material Flow Proses -- semua tahap dianggap "Tidak Wajib"
            sampai dicentang &amp; disimpan di sini (kecuali QC/Packing, selalu wajib).
          </p>
        )}
        {materialNumber && checked && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tahap</th>
                    <th>Wajib?</th>
                    <th>Status Order Ini</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGE_ROWS.map((s) => {
                    const isRequired = checked[s.field];
                    const done = statusByName.get(s.name);
                    return (
                      <tr key={s.field}>
                        <td>{s.name}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={isRequired}
                            disabled={!canEdit || s.mandatory}
                            title={s.mandatory ? "Wajib mutlak utk semua Material, tidak bisa diubah" : undefined}
                            onChange={(e) => setChecked((c) => (c ? { ...c, [s.field]: e.target.checked } : c))}
                          />
                        </td>
                        <td>
                          {!isRequired ? (
                            <span style={{ color: "var(--text-muted)" }}>Tidak Wajib</span>
                          ) : done === undefined ? (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
                          ) : done ? (
                            <span className="status-text">Selesai</span>
                          ) : (
                            <span className="error-text">Belum</span>
                          )}
                        </td>
                        <td>
                          {onOpenStage && (
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                              title={`Buka Input ${s.name}`}
                              onClick={() => {
                                const blocking = findBlockingStage(s.name);
                                if (blocking) {
                                  window.alert(
                                    `Order ini belum menyelesaikan ${blocking} -- harus diinput dulu sebelum bisa input ${s.name}.`
                                  );
                                  return;
                                }
                                onOpenStage(s.name);
                              }}
                            >
                              Buka Input ➜
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canEdit ? (
              <>
                {error && <p className="error-text">{error}</p>}
                {message && <p className="status-text">{message}</p>}
                <button
                  className="btn"
                  type="button"
                  style={{ marginTop: 12 }}
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? "Menyimpan..." : "Simpan Perubahan Wajib/Tidak"}
                </button>
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Perubahan di sini berlaku utk SEMUA Order dgn Material Number yang sama, bukan cuma Order ini.
                </p>
              </>
            ) : (
              <p style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--text-muted)" }}>
                Cuma akun Full Access yang bisa mengubah Wajib/Tidak-nya tahap.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
