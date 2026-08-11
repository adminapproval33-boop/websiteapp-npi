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
  orderType,
  order,
  onFlowSaved,
  onOpenStage,
}: {
  materialNumber: string | null;
  /** Dari `r.stages` baris Dashboard -- HANYA berisi tahap yg SAAT INI
   * wajib (hasil MaterialFlow terkini), dipakai utk status Selesai/Belum. */
  stages: { name: string; done: boolean }[];
  /** Kolom "Order Type" Order ini dari Referensi Order/PO (SAP-COOISPI)
   * (2026-08-03, instruksi eksplisit user) -- Order dgn Order Type RF01/RF02
   * TIDAK BOLEH mengubah Master Data Material Flow Proses dari popup ini
   * (checkbox "Wajib?" tetap bisa dicentang utk lihat tampilan, tapi tombol
   * Simpan dikunci) krn Master Data Material Flow berlaku global utk SEMUA
   * Order dgn Material Number yg sama, sedangkan RF01/RF02 adalah kasus
   * khusus per-Order (rework/return) yg tidak boleh ikut mengubah baku utk
   * Order normal lain. */
  orderType?: string | null;
  /** Nomor Order (2026-08-03, instruksi eksplisit user: tampilkan baris
   * "Bongkaran" di tabel ini) -- HANYA dipakai utk lookup status Bongkaran
   * Order ini sendiri (GET /bongkaran/latest-by-order), TIDAK dipakai field
   * lain di panel ini. Optional krn 1 pemanggil (preview Material Number di
   * ManualInputModal) belum py Order spesifik -- baris Bongkaran otomatis
   * disembunyikan kalau prop ini kosong. */
  order?: string | null;
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
  /** FULL_ACCESS & INPUT boleh edit, VIEW tetap ditolak (2026-08-05, instruksi
   * eksplisit user: user akses Input perlu bisa menceklis kolom Wajib di sini
   * -- backend sinkron, lihat requireWrite di masterdata.routes.ts PUT
   * /material-flow/:materialNumber). */
  const canEdit = user?.access === "FULL_ACCESS" || user?.access === "INPUT";
  const isRfOrder = orderType === "RF01" || orderType === "RF02";
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

  /// Status "Bongkaran" Order ini sendiri -- BEDA dari `stages` prop (yg
  /// datang dari MaterialFlow/Proses Bar), krn Bongkaran sengaja tidak ikut
  /// sistem itu (lihat catatan `order` prop di atas).
  const bongkaranQuery = useQuery({
    queryKey: ["bongkaran-latest-by-order", order],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { sendToPqe: string | null } | null }>(
          `/bongkaran/latest-by-order/${encodeURIComponent(order!)}`
        )
        .then((r) => r.data),
    enabled: !!order,
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
   * eksplisit user; DIREVISI 2026-08-07 -- "proses berurutan hanya berlaku
   * utk produksi saja"): kalau ADA tahap PRODUKSI SEBELUM X (di urutan Proses
   * Bar, `stages` -- sudah terurut Premix->Milling->...->Packing) yg belum
   * "done", tolak & kasih tahu tahap mana yg harus diinput dulu -- BUKAN
   * langsung buka form lalu baru gagal pas Save (gerbang aslinya tetap di
   * backend, lib/stageGate.ts -- ini cuma kasih tahu di awal drpd bikin admin
   * isi form dulu baru ketahuan ditolak). QC/Approval/Packing SENDIRI tidak
   * pernah diblokir menunggu tahap sebelumnya (sama seperti backend: gerbang
   * checkQcGate/hasAdminQcQcPassed/hasAdminQcApprovalType sudah dihapus total),
   * dan tahap produksi yg TIDAK WAJIB (tidak ada di `stages`) dibiarkan lewat
   * -- bukan bagian urutan resmi Material ini. */
  const PRODUCTION_STAGES = new Set(["Premix", "Milling", "Aftermix", "Colour Matching"]);
  function findBlockingStage(stageName: string): string | null {
    if (!PRODUCTION_STAGES.has(stageName)) return null;
    const idx = stages.findIndex((s) => s.name === stageName);
    if (idx <= 0) return null;
    const blocking = stages.slice(0, idx).find((s) => PRODUCTION_STAGES.has(s.name) && !s.done);
    return blocking?.name ?? null;
  }

  /** Gerbang KHUSUS tombol "Production Label" (2026-08-11, instruksi eksplisit
   * user; DIREVISI hari yg sama -- Packing ditambahkan ke pengecualian) --
   * BEDA dari findBlockingStage di atas (yg cuma cek antar-tahap PRODUKSI
   * berurutan). Production Label baru bisa dibuka kalau SEMUA tahap `stages`
   * lain (yg wajib utk Material ini) sudah Selesai, KECUALI QC, Approval, &
   * Packing -- ketiganya sengaja dikecualikan (boleh menyusul/paralel setelah
   * label dicetak). Tahap yg TIDAK WAJIB (tidak ada di `stages`) otomatis
   * tidak ikut dicek, sama seperti findBlockingStage. */
  const LABEL_GATE_EXCLUDED_STAGES = new Set(["QC", "Approval", "Packing"]);
  function findBlockingStageForLabel(): string | null {
    const blocking = stages.find((s) => !LABEL_GATE_EXCLUDED_STAGES.has(s.name) && !s.done);
    return blocking?.name ?? null;
  }

  /** Tahap yg py gerbang "Wajib?" di backend (2026-08-06, instruksi eksplisit
   * user, lihat checkStageApplicableGate di lib/stageGate.ts) -- HANYA Premix/
   * Milling/Aftermix/Colour Matching. QC & Packing selalu wajib mutlak (tidak
   * relevan). Approval SENGAJA tidak diikutkan -- gerbang AdminQc-nya sudah
   * dihapus total (2026-08-06, instruksi eksplisit user sebelumnya: Approval
   * bebas diinput spt Packing), jadi peringatan di sini tidak boleh
   * menyiratkan Approval masih terkunci Wajib/Tidak. */
  const STAGES_WITH_APPLICABILITY_GATE = new Set(["Premix", "Milling", "Aftermix", "Colour Matching"]);

  function renderStageRow(s: (typeof STAGE_ROWS)[number]) {
    const isRequired = checked![s.field];
    const done = statusByName.get(s.name);
    return (
      <tr key={s.field}>
        <td>{s.name}</td>
        <td>
          <input
            type="checkbox"
            checked={isRequired}
            disabled={!canEdit || s.mandatory || !materialNumber}
            title={
              s.mandatory
                ? "Wajib mutlak utk semua Material, tidak bisa diubah"
                : !materialNumber
                ? "Material Number belum diketahui, tidak bisa disimpan"
                : undefined
            }
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
                if (STAGES_WITH_APPLICABILITY_GATE.has(s.name) && !isRequired) {
                  window.alert(`Material ini tidak memakai proses ${s.name}.`);
                  return;
                }
                const blocking = findBlockingStage(s.name);
                if (blocking) {
                  window.alert(`Order ini belum menyelesaikan ${blocking} -- harus diinput dulu sebelum bisa input ${s.name}.`);
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
  }

  /** Baris "Bongkaran" (2026-08-03, instruksi eksplisit user) -- SENGAJA
   * TIDAK pakai renderStageRow di atas (beda struktur total: tidak ada
   * checkbox Wajib/Tidak krn tidak terhubung Master Data Material Flow
   * Proses sama sekali, status Selesai/Belum-nya dari GET
   * /bongkaran/latest-by-order, bukan dari `stages` prop). Cuma tampil kalau
   * `order` diketahui (lihat catatan prop di atas). */
  function renderBongkaranRow() {
    if (!order) return null;
    return (
      <tr key="bongkaran">
        <td>Bongkaran</td>
        <td>
          <span
            style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
            title='Bongkaran tidak terhubung ke Master Data Material Flow Proses -- selalu tersedia utk Order manapun, tidak ada konsep "Wajib/Tidak" per Material.'
          >
            -
          </span>
        </td>
        <td>
          {bongkaranQuery.isLoading ? (
            <span style={{ color: "var(--text-muted)" }}>—</span>
          ) : bongkaranQuery.data?.sendToPqe ? (
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
              title="Buka Input Bongkaran"
              onClick={() => onOpenStage("Bongkaran")}
            >
              Buka Input ➜
            </button>
          )}
        </td>
      </tr>
    );
  }

  /** Baris "Production Label" (2026-08-11, instruksi eksplisit user: supaya
   * admin tidak perlu bolak-balik ke menu Production Label terpisah utk
   * cetak label) -- diletakkan PALING BAWAH, setelah Packing. Sama pola dgn
   * Bongkaran: TIDAK terhubung Master Data Material Flow Proses (tidak ada
   * "Wajib/Tidak"), dan cetak label bisa dilakukan berkali-kali (bukan
   * konsep sekali-selesai) jadi kolom Status ditampilkan "-" juga, bukan
   * Selesai/Belum. Cuma tampil kalau `order` diketahui. */
  function renderProductionLabelRow() {
    if (!order) return null;
    return (
      <tr key="production-label">
        <td>Production Label</td>
        <td>
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }} title="Tidak terhubung ke Master Data Material Flow Proses.">
            -
          </span>
        </td>
        <td>
          <span style={{ color: "var(--text-muted)" }}>-</span>
        </td>
        <td>
          {onOpenStage && (
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: "3px 10px", fontSize: "0.78rem" }}
              title="Buka Production Label"
              onClick={() => {
                const blocking = findBlockingStageForLabel();
                if (blocking) {
                  window.alert(`Order ini belum menyelesaikan ${blocking} -- harus diinput dulu sebelum bisa cetak Production Label.`);
                  return;
                }
                onOpenStage("Production Label");
              }}
            >
              Buka Input ➜
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="panel-header" style={{ padding: "10px 20px" }}>
        Info Proses Material{materialNumber ? ` — ${materialNumber}` : ""}
      </div>
      <div className="panel-body" style={{ padding: 14 }}>
        {isRfOrder && (
          <p style={{ color: "var(--warning, #b7791f)", marginTop: 0, marginBottom: 8, fontSize: "0.85rem" }}>
            Order Type Order ini <strong>{orderType}</strong> -- centang "Wajib?" di tabel ini cuma tampilan
            sementara utk Order ini sendiri, TIDAK akan mengubah Master Data Material Flow Proses (yg berlaku utk
            SEMUA Order dgn Material Number yang sama).
          </p>
        )}
        {!materialNumber && (
          <p style={{ color: "var(--warning, #b7791f)", marginTop: 0, marginBottom: 8, fontSize: "0.85rem" }}>
            Material Number Order ini belum diketahui (Order tidak terdaftar di Master Data Referensi Order/PO) --
            tabel tahap di bawah tetap bisa dipakai utk buka Input tiap proses, tapi centang "Wajib?" tidak bisa
            disimpan permanen sampai Material Number-nya diketahui.
          </p>
        )}
        {materialNumber && flowQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
        {materialNumber && !flowQuery.isLoading && !flowQuery.data && (
          <p style={{ color: "var(--warning, #b7791f)", marginTop: 0, marginBottom: 8, fontSize: "0.85rem" }}>
            Material ini belum terdaftar di Master Data &gt; Material Flow Proses -- semua tahap dianggap "Tidak Wajib"
            sampai dicentang &amp; disimpan di sini (kecuali QC/Packing, selalu wajib).
          </p>
        )}
        {checked && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table mf-compact-table">
                <thead>
                  <tr>
                    <th>Tahap</th>
                    <th>Wajib?</th>
                    <th>Status Order Ini</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGE_ROWS.slice(0, 4).map(renderStageRow)}
                  {renderBongkaranRow()}
                  {STAGE_ROWS.slice(4).map(renderStageRow)}
                  {renderProductionLabelRow()}
                </tbody>
              </table>
            </div>
            {isRfOrder ? (
              <p style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--text-muted)" }}>
                Simpan Perubahan Wajib/Tidak dikunci utk Order Type {orderType} -- pengaturan Wajib/Tidak baku utk
                Material ini hanya bisa diubah lewat Order dgn Order Type normal, atau langsung di Master Data &gt;
                Material Flow Proses.
              </p>
            ) : !materialNumber ? (
              <p style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--text-muted)" }}>
                Pengaturan "Wajib?" baru bisa disimpan begitu Material Number Order ini diketahui (mis. setelah
                terisi lewat salah satu form Input di atas).
              </p>
            ) : canEdit ? (
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
                Akun dengan akses View tidak bisa mengubah Wajib/Tidak-nya tahap.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
