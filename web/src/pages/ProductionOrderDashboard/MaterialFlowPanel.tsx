import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Modal from "../../components/Modal";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatInputBy, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { formatDateTime } from "../../lib/datetime";
import { useResizableColWidths } from "../../lib/useResizableColWidths";

/** Lebar default kolom pop-up Booking Tanki (px) -- bisa di-drag user, sama
 * seperti form Input Premix/Aftermix (lihat lib/useResizableColWidths). */
const BOOKING_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 220,
  materialNumber: 220,
  materialDescription: 320,
  batch: 180,
  orderQty: 140,
  plant: 120,
  codeTanki: 220,
  plannedStart: 240,
  bookedBy: 300,
  catatan: 760,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag) -- harus cocok
 * dgn urutan ExcelField di pop-up Booking Tanki di bawah. */
const BOOKING_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription"],
  ["batch", "orderQty", "plant"],
  ["codeTanki", "plannedStart", "bookedBy"],
  ["catatan"],
];
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import type { OrderRefData } from "../../components/OrderLookup";

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
  onCloseAll,
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
  /** Tombol "Tutup" pop-up Booking Tanki menutup SEMUANYA (termasuk pop-up Info
   * Proses induknya), sama pola dgn pop-up "Input <Tahap>"; "Kembali" cuma
   * menutup pop-up Booking. */
  onCloseAll?: () => void;
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

  // Tombol "Booking" tanki (2026-09-20, instruksi eksplisit user) di baris
  // Premix & Aftermix -- memesan Code Tanki utk Order ini SEBELUM proses
  // dimulai. Disimpan lewat POST /tank-manual-input (Input Manual Tank
  // Monitoring): tanki langsung tampil "Terisi" (sumber "Manual") dgn Order
  // ini, TANPA membuat baris Premix/Aftermix (Start/Finish/Member belum ada).
  const [bookingStage, setBookingStage] = useState<"Premix" | "Aftermix" | null>(null);
  const [bookingTank, setBookingTank] = useState("");
  const [bookingRemark, setBookingRemark] = useState("");
  // Rencana Mulai pemakaian tanki (datetime-local, opsional) -- 2026-09-20,
  // instruksi eksplisit user.
  const [bookingPlannedStart, setBookingPlannedStart] = useState("");
  const [bookingMessage, setBookingMessage] = useState("");
  const [bookingError, setBookingError] = useState("");
  const { data: tankOptions } = useTankOptions();
  const { data: employees } = useEmployeeOptions();
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    BOOKING_COL_DEFAULT_WIDTHS,
    "booking-tanki-col-widths",
    BOOKING_COL_ROWS
  );
  /** "Booked by" pop-up = user yg sedang login ("Nama (NIK)", sama format kolom
   * Input By di menu History) -- fallback ke nama sesi kalau NIK-nya tidak ada
   * di Data Karyawan (mis. akun admin). */
  const bookedByLabel = user
    ? (() => {
        const formatted = formatInputBy(employees, user.nik);
        return formatted === user.nik ? `${user.name} (${user.nik})` : formatted;
      })()
    : "-";

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

  /// Status "Production Label" Order ini sendiri (2026-08-12, instruksi
  /// eksplisit user: kalau sudah pernah dicetak, kolom "Status Order Ini"
  /// jadi "Selesai") -- sama pola dgn bongkaranQuery di atas, TIDAK terhubung
  /// Master Data Material Flow Proses.
  const productionLabelQuery = useQuery({
    queryKey: ["production-label-latest-by-order", order],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { id: string } | null }>(
          `/production-label/latest-by-order/${encodeURIComponent(order!)}`
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

  // Data Order utk ditampilkan (read-only) di pop-up Booking & ikut disimpan --
  // dari Referensi Order/PO. Kalau Order tidak ketemu di sana, form tetap bisa
  // dipakai (cuma Order + Code Tanki yg wajib).
  const orderRefQuery = useQuery({
    queryKey: ["order-ref-booking", order],
    queryFn: () => api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(order!)}`).then((r) => r.data),
    enabled: !!bookingStage && !!order,
    retry: false,
  });
  const ref: OrderRefData | null = orderRefQuery.data ?? null;

  const bookingMutation = useMutation({
    mutationFn: async () => {
      return api.post("/tank-manual-input/booking", {
        section: bookingStage === "Premix" ? "PREMIX" : "AFTERMIX",
        codeTanki: bookingTank.trim(),
        order: order!,
        materialNumber: ref?.materialNumber ?? materialNumber ?? undefined,
        materialDescription: ref?.materialDescription ?? undefined,
        batch: ref?.batch ?? undefined,
        orderQty: ref?.orderQty ?? undefined,
        note: bookingRemark.trim() || undefined,
        plannedStart: bookingPlannedStart || undefined,
      });
    },
    onSuccess: () => {
      setBookingMessage(`Booking tanki ${bookingTank.trim()} utk Order ${order} (${bookingStage}) tersimpan -- tanki tampil "Terisi" di Tank Monitoring.`);
      setBookingError("");
      setBookingStage(null);
      setBookingTank("");
      setBookingRemark("");
      setBookingPlannedStart("");
      queryClient.invalidateQueries({ queryKey: ["tank-status"] });
      queryClient.invalidateQueries({ queryKey: ["tank-booking-list", order] });
    },
    onError: (err) => setBookingError(err instanceof ApiError ? err.message : "Gagal menyimpan booking tanki."),
  });

  // Booking yg MASIH AKTIF utk Order ini -- diambil dari Tank Monitoring
  // (query key sama dgn TankDashboardPage), jadi otomatis sudah menyaring
  // booking yg gugur (Order sudah di-input di tahapnya / tanki dipakai Order
  // lain, lihat isBookingReleased di server dashboard.routes.ts).
  const tankStatusQuery = useQuery({
    queryKey: ["tank-status"],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { code: string; occupant: { order: string; source: string; remark: string | null } | null }[] }>(
          "/dashboard/tank-status"
        )
        .then((r) => r.data),
    enabled: !!order,
  });
  const activeBookings = (tankStatusQuery.data ?? []).filter(
    (t) => t.occupant?.source === "Manual" && t.occupant.order === order && /^Booking (Premix|Aftermix)\b/.test(t.occupant.remark ?? "")
  );
  // Detail booking (Rencana Mulai & pemesan) -- dicocokkan ke `activeBookings`
  // lewat Code Tanki (entri TERBARU per tanki, sama aturan "yg terbaru menang"
  // di Tank Monitoring).
  const bookingListQuery = useQuery({
    queryKey: ["tank-booking-list", order],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { id: string; codeTanki: string; plannedStart: string | null; inputBy: string; inputByName: string | null }[] }>(
          `/tank-manual-input/booking?order=${encodeURIComponent(order!)}`
        )
        .then((r) => r.data),
    enabled: !!order,
  });
  const bookingDetailByTank = new Map<string, { plannedStart: string | null; inputBy: string; inputByName: string | null }>();
  for (const b of bookingListQuery.data ?? []) {
    if (!bookingDetailByTank.has(b.codeTanki)) bookingDetailByTank.set(b.codeTanki, b);
  }

  const cancelBookingMutation = useMutation({
    mutationFn: (codeTanki: string) => api.post("/tank-manual-input/booking/cancel", { order: order!, codeTanki }),
    onSuccess: (_d, codeTanki) => {
      setBookingMessage(`Booking tanki ${codeTanki} utk Order ${order} dibatalkan.`);
      setBookingError("");
      queryClient.invalidateQueries({ queryKey: ["tank-status"] });
      queryClient.invalidateQueries({ queryKey: ["tank-booking-list", order] });
    },
    onError: (err) => setBookingError(err instanceof ApiError ? err.message : "Gagal membatalkan booking tanki."),
  });

  function closeBookingModal() {
    setBookingStage(null);
    setBookingTank("");
    setBookingRemark("");
    setBookingPlannedStart("");
    setBookingError("");
  }

  function submitBooking() {
    setBookingMessage("");
    setBookingError("");
    if (!bookingTank.trim()) {
      setBookingError("Code Tanki wajib diisi.");
      return;
    }
    if (!isKnownTankCode(tankOptions, bookingTank)) {
      setBookingError("Code Tanki tidak ada di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    bookingMutation.mutate();
  }

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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
            {order && canEdit && (s.name === "Premix" || s.name === "Aftermix") && (
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                disabled={!isRequired}
                title={isRequired ? `Booking tanki utk ${s.name}` : `Material ini tidak memakai proses ${s.name}.`}
                onClick={() => {
                  setBookingStage(s.name as "Premix" | "Aftermix");
                  setBookingMessage("");
                  setBookingError("");
                }}
              >
                Booking
              </button>
            )}
          </div>
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
   * "Wajib/Tidak"). Kolom Status (2026-08-12, instruksi eksplisit user):
   * "Selesai" kalau Order ini SUDAH PERNAH dicetak labelnya (ada baris di
   * ProductionLabel, lihat productionLabelQuery/GET
   * /production-label/latest-by-order/:order), kalau belum tetap "-" (bukan
   * "Belum" -- cetak label bukan konsep wajib/sekali-selesai, bisa dicetak
   * ulang kapan saja). Cuma tampil kalau `order` diketahui. */
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
          {productionLabelQuery.isLoading ? (
            <span style={{ color: "var(--text-muted)" }}>—</span>
          ) : productionLabelQuery.data ? (
            <span className="status-text">Selesai</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>-</span>
          )}
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
            {activeBookings.length > 0 && (
              <div style={{ marginTop: 10, fontSize: "0.82rem" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Booking tanki aktif Order ini</div>
                {activeBookings.map((b) => {
                  const detail = bookingDetailByTank.get(b.code);
                  return (
                  <div key={b.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                    <span style={{ flex: 1 }}>
                      {b.code} — {b.occupant?.remark}
                      {detail?.plannedStart ? ` — Rencana mulai ${formatDateTime(detail.plannedStart)}` : ""}
                      {detail ? ` — oleh ${detail.inputByName ? `${detail.inputByName} (${detail.inputBy})` : detail.inputBy}` : ""}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: "2px 10px", fontSize: "0.75rem" }}
                        disabled={cancelBookingMutation.isPending}
                        onClick={() => cancelBookingMutation.mutate(b.code)}
                      >
                        Batalkan
                      </button>
                    )}
                  </div>
                  );
                })}
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: 2 }}>
                  Booking gugur otomatis begitu Order ini di-input di tahap yang di-booking, atau tanki dipakai Order lain.
                </div>
              </div>
            )}
            {bookingMessage && <p className="status-text" style={{ marginTop: 8, marginBottom: 0 }}>{bookingMessage}</p>}
            {!bookingStage && bookingError && <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>{bookingError}</p>}
            {/* Form Booking Tanki = pop-up TERPISAH dari Info Proses Material
                (2026-09-20, instruksi eksplisit user) -- lewat portal ke body
                spy tidak ikut ke-scroll/ke-clip di dalam pop-up Info Proses. */}
            {bookingStage &&
              createPortal(
                <Modal
                  title={`Booking Tanki ${bookingStage} — Order ${order}`}
                  onClose={() => {
                    closeBookingModal();
                    onCloseAll?.();
                  }}
                  onBack={closeBookingModal}
                  width={860}
                  closeOnBackdropClick={false}
                >
                  <div className="panel">
                    <div className="panel-body">
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                        <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                          ↺ Reset Lebar Kolom
                        </button>
                      </div>
                      <ExcelBlock title={`Production & MRP Schedule » ${bookingStage}, Booking Tanki`}>
                        {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
                        <ExcelRow>
                          <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")}>
                            <input value={order ?? ""} readOnly />
                          </ExcelField>
                          <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")}>
                            <input value={ref?.materialNumber ?? materialNumber ?? ""} readOnly />
                          </ExcelField>
                          <ExcelField label="Material Description" widthPx={colWidths.materialDescription} onResizeStart={beginResize("materialDescription")}>
                            <input value={ref?.materialDescription ?? ""} readOnly />
                          </ExcelField>
                        </ExcelRow>
                        <ExcelRow>
                          <ExcelField label="Batch" widthPx={colWidths.batch} onResizeStart={beginResize("batch")}>
                            <input value={ref?.batch ?? ""} readOnly />
                          </ExcelField>
                          <ExcelField label="Order Qty" widthPx={colWidths.orderQty} onResizeStart={beginResize("orderQty")}>
                            <input value={ref?.orderQty ?? ""} readOnly />
                          </ExcelField>
                          <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")}>
                            <input value={ref?.plant ?? ""} readOnly />
                          </ExcelField>
                        </ExcelRow>
                        <ExcelRow>
                          <ExcelField label="Code Tanki *" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")}>
                            <TankSelect bare id="mf-booking-tank" value={bookingTank} onChange={setBookingTank} />
                          </ExcelField>
                          <ExcelField label="Rencana Mulai" widthPx={colWidths.plannedStart} onResizeStart={beginResize("plannedStart")}>
                            <input type="datetime-local" value={bookingPlannedStart} onChange={(e) => setBookingPlannedStart(e.target.value)} />
                          </ExcelField>
                          <ExcelField label="Booked By" widthPx={colWidths.bookedBy} onResizeStart={beginResize("bookedBy")}>
                            <input value={bookedByLabel} readOnly />
                          </ExcelField>
                        </ExcelRow>
                        <ExcelRow>
                          <ExcelField label="Catatan" widthPx={colWidths.catatan} onResizeStart={beginResize("catatan")}>
                            <input value={bookingRemark} onChange={(e) => setBookingRemark(e.target.value)} />
                          </ExcelField>
                        </ExcelRow>
                      </ExcelBlock>
                      <p style={{ margin: "10px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        * Wajib diisi. Tanki langsung tampil "Terisi" (sumber Manual) di Tank Monitoring dengan Order ini, dan
                        gugur otomatis begitu Order ini di-input di tahap {bookingStage} atau tanki dipakai Order lain.
                      </p>
                      {bookingError && <p className="error-text" style={{ margin: "8px 0 0" }}>{bookingError}</p>}
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                        <button type="button" className="btn" disabled={bookingMutation.isPending} onClick={submitBooking}>
                          {bookingMutation.isPending ? "Menyimpan..." : "Simpan Booking"}
                        </button>
                      </div>
                    </div>
                  </div>
                </Modal>,
                document.body
              )}
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
