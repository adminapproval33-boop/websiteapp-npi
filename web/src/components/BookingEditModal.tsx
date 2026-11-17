import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Modal from "./Modal";
import TankSelect, { useTankLocationPlantMap } from "./TankSelect";
import { ExcelBlock, ExcelRow, ExcelField } from "./ExcelGrid";
import { formatInputBy, useEmployeeOptions } from "./EmployeeNameSelect";
import type { OrderRefData } from "./OrderLookup";
import { toDateTimeLocalValue, formatDateTime } from "../lib/datetime";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { ScheduleEvent } from "./WeeklyScheduleCalendar";

interface BookingRow {
  id: string;
  codeTanki: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  remark: string | null;
  plannedStart: string | null;
  inputBy: string;
  timestamp: string;
  inputByName: string | null;
}

/** Urai "Catatan" dari format remark yg ditulis lib/tankBooking.ts server
 * (`Booking <Label>` atau `Booking <Label> - <note>`) -- dibalik persis di
 * sini supaya form edit bisa prefill Catatan apa adanya. */
function noteFromRemark(remark: string | null, prefix: string): string {
  if (!remark || !remark.startsWith(prefix)) return "";
  const rest = remark.slice(prefix.length);
  return rest.startsWith(" - ") ? rest.slice(3) : "";
}

/** Popup "Booking Tanki" dipicu double-click kartu Kalender PWO Schedule
 * (2026-10-20, instruksi eksplisit user) -- tampilan Excel-grid disamakan
 * PERSIS dgn popup "Booking" yg sudah ada di MaterialFlowPanel.tsx (Info
 * Proses Production Order Monitoring), TERMASUK kolom "Rencana Mulai" (user
 * eksplisit minta kolom ini jg disamakan, 2026-10-20), TAPI beda kemampuan:
 * popup ini EDIT booking yg sudah ada (PUT /tank-manual-input/booking/:id)
 * kalau Order ini sudah dibooking, atau BUAT baru (POST
 * /tank-manual-input/booking, endpoint yg sama) kalau belum. Mengisi Rencana
 * Mulai di sini IKUT menggeser kartu di Kalender (sama persis perilaku popup
 * Booking asli, lihat `syncPwoScheduleFromPlannedStart` di
 * tankManualInput.routes.ts) -- SENGAJA konsisten, bukan read-only, supaya
 * popup ini benar2 identik dgn referensinya, bukan cuma miripnya saja. */
export default function BookingEditModal({
  ev,
  section,
  onClose,
  readOnly,
}: {
  ev: ScheduleEvent;
  section: "PREMIX" | "AFTERMIX";
  onClose: () => void;
  /** Akses View-only utk menu "Booking & Schedule Tanki" (2026-11-16, instruksi
   * eksplisit user: menu ini jadi SATU-SATUNYA gate semua cara booking tanki) --
   * popup tetap bisa dibuka utk dilihat, tapi semua kolom & tombol Simpan
   * dinonaktifkan. */
  readOnly?: boolean;
}) {
  const label = section === "PREMIX" ? "Premix" : "Aftermix";
  const prefix = `Booking ${label}`;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: employees } = useEmployeeOptions();

  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ["tank-booking-list", ev.order],
    queryFn: () =>
      api
        .get<{ success: boolean; data: BookingRow[] }>(`/tank-manual-input/booking?order=${encodeURIComponent(ev.order)}`)
        .then((r) => r.data),
  });

  // Order Qty/Plant TIDAK ada di ScheduleEvent (PwoSchedule tidak menyimpan
  // kolom itu) -- lookup live ke Referensi Order/PO (SAP-COOISPI), endpoint
  // yg sama dipakai OrderLookup.tsx, supaya tampilannya cocok dgn popup
  // referensi.
  const { data: ref } = useQuery({
    queryKey: ["order-ref", ev.order],
    queryFn: () => api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(ev.order)}`).then((r) => r.data),
  });

  // Booking TERBARU utk section kartu ini (endpoint sudah urut timestamp
  // desc, jadi .find ambil yg paling baru duluan).
  const existing = bookings?.find((b) => b.remark?.startsWith(prefix)) ?? null;

  const [codeTanki, setCodeTanki] = useState("");
  // Material Number/Material Description/Batch/Order Qty/Plant (2026-11-17,
  // instruksi eksplisit user) -- SEKARANG bisa diedit manual & WAJIB diisi,
  // BUKAN lagi read-only murni dari lookup Referensi Order/PO -- Order lama
  // yg belum/tidak kedapatan di Referensi (mis. Order demo) harus bisa
  // dikoreksi manual lewat popup ini, sama kemampuan dgn popup "+Booking
  // Tanki" (lihat validateBooking di bawah).
  const [materialNumber, setMaterialNumber] = useState("");
  const [materialDescription, setMaterialDescription] = useState("");
  const [batch, setBatch] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [plant, setPlant] = useState("");
  const [note, setNote] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [error, setError] = useState("");
  // Peringatan "tanki sudah dibooking Order lain" (2026-11-10, instruksi
  // eksplisit user) -- sama pola dgn MaterialFlowPanel.tsx, lihat komentar
  // lengkap di sana.
  const [conflict, setConflict] = useState<{ order: string; plannedStart: string | null } | null>(null);

  // Dependency SENGAJA ikut `existing?.plannedStart` (bukan cuma `existing?.id`
  // -- baris booking yg SAMA, id-nya tidak berubah) supaya popup ini ikut
  // ter-refresh begitu query booking selesai refetch stale-nya (dipicu
  // invalidate dari drag-drop/Jadwalkan pindah hari, lihat sync di
  // PremixAftermixPage.tsx), TANPA user perlu refresh browser manual
  // (2026-10-20, bugfix instruksi eksplisit user: sebelumnya field ini
  // nyangkut di nilai lama krn effect cuma jalan ulang kalau id-nya beda).
  useEffect(() => {
    if (existing) {
      setCodeTanki(existing.codeTanki);
      setMaterialNumber(existing.materialNumber ?? "");
      setMaterialDescription(existing.materialDescription ?? "");
      setBatch(existing.batch ?? "");
      setOrderQty(existing.orderQty ?? "");
      setPlant(existing.plant ?? "");
      setNote(noteFromRemark(existing.remark, prefix));
      setPlannedStart(toDateTimeLocalValue(existing.plannedStart));
    } else {
      setPlannedStart(toDateTimeLocalValue(ev.scheduledDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    existing?.id,
    existing?.plannedStart,
    existing?.codeTanki,
    existing?.remark,
    existing?.materialNumber,
    existing?.materialDescription,
    existing?.batch,
    existing?.orderQty,
    existing?.plant,
  ]);

  // Booking BARU (belum ada `existing`) -- isi awal dari Referensi Order/PO
  // (`ref`) kalau ketemu, fallback ke `ev` (PwoSchedule) utk Material Number/
  // Description/Batch -- SEKALI saja, TANPA menimpa kalau user sudah mulai
  // ngetik manual (Order-nya tidak ketemu di Referensi), beda dgn tampilan
  // read-only versi lama yg terus-menerus ikut `ref`.
  useEffect(() => {
    if (existing || !ref) return;
    setMaterialNumber((v) => v || ref.materialNumber || ev.materialNumber || "");
    setMaterialDescription((v) => v || ref.materialDescription || ev.materialDescription || "");
    setBatch((v) => v || ref.batch || ev.batch || "");
    setOrderQty((v) => v || ref.orderQty || "");
    setPlant((v) => v || ref.plant || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, ref]);

  // IU Plant (2026-11-17, instruksi eksplisit user) -- LOOKUP dari kolom
  // "Location / Plant" Master Data » Daftar Code Tanki berdasarkan Code
  // Tanki yg sedang diisi, GANTIKAN dropdown bebas IU Plant 1-6 yg
  // sebelumnya lepas dari tanki mana yg dipilih.
  const { data: tankLocationPlantMap } = useTankLocationPlantMap();
  const iuPlant = tankLocationPlantMap?.get(codeTanki.trim()) ?? "";

  const bookedByLabel = existing
    ? existing.inputByName
      ? `${existing.inputByName} (${existing.inputBy})`
      : existing.inputBy
    : user
      ? (() => {
          const formatted = formatInputBy(employees, user.nik);
          return formatted === user.nik ? `${user.name} (${user.nik})` : formatted;
        })()
      : "-";

  const saveMutation = useMutation({
    mutationFn: async (force?: boolean) => {
      if (existing) {
        return api.put(`/tank-manual-input/booking/${existing.id}`, {
          codeTanki: codeTanki.trim(),
          materialNumber: materialNumber.trim(),
          materialDescription: materialDescription.trim(),
          batch: batch.trim(),
          orderQty: orderQty.trim(),
          plant: plant.trim(),
          iuPlant: iuPlant.trim() || undefined,
          note: note.trim() || undefined,
          plannedStart: plannedStart || undefined,
          force: force || undefined,
        });
      }
      return api.post("/tank-manual-input/booking", {
        section,
        codeTanki: codeTanki.trim(),
        order: ev.order,
        materialNumber: materialNumber.trim(),
        materialDescription: materialDescription.trim(),
        batch: batch.trim(),
        orderQty: orderQty.trim(),
        plant: plant.trim(),
        iuPlant: iuPlant.trim() || undefined,
        note: note.trim() || undefined,
        plannedStart: plannedStart || undefined,
        force: force || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] });
      queryClient.invalidateQueries({ queryKey: ["tank-status"] });
      queryClient.invalidateQueries({ queryKey: ["tank-booking-list", ev.order] });
      // Bugfix (2026-11-17, laporan nyata user) -- SEBELUMNYA query ini tidak
      // ikut di-invalidate, jadi "Filter Code Tanki" di PremixAftermixPage.tsx
      // (queryKey sama, dibangun jadi `tankByOrder`/matchesQueueTankFilter)
      // memakai data booking BASI sampai halaman di-reload manual.
      queryClient.invalidateQueries({ queryKey: ["tank-booking-list-all", section] });
      onClose();
    },
    onError: (err) => {
      // Respons 409 TANK_ALREADY_BOOKED (2026-11-10) -- peringatan, bukan
      // error fatal, lihat komentar `conflict` di atas & POST /booking di
      // server utk detail lengkapnya.
      if (err instanceof ApiError && err.status === 409 && (err.body as { code?: string })?.code === "TANK_ALREADY_BOOKED") {
        setConflict((err.body as { conflict: { order: string; plannedStart: string | null } }).conflict);
        setError("");
        return;
      }
      setConflict(null);
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan booking tanki.");
    },
  });

  /** Semua field WAJIB diisi (2026-11-17, instruksi eksplisit user: samakan
   * dgn popup "+Booking Tanki") -- dicek saat klik Simpan, bukan cuma disable
   * tombolnya diam2, supaya user benar2 lihat pesan kenapa ditolak. */
  function validateBooking(): string | null {
    if (!materialNumber.trim()) return "Material Number wajib diisi.";
    if (!materialDescription.trim()) return "Material Description wajib diisi.";
    if (!batch.trim()) return "Batch wajib diisi.";
    if (!orderQty.trim()) return "Order Qty (KG) wajib diisi.";
    if (!plant.trim()) return "Plant wajib diisi.";
    if (!codeTanki.trim()) return "Code Tanki wajib diisi.";
    if (!plannedStart) return "Rencana Mulai wajib diisi.";
    return null;
  }

  function submit() {
    if (readOnly) return;
    setError("");
    setConflict(null);
    const err = validateBooking();
    if (err) {
      setError(err);
      return;
    }
    saveMutation.mutate(false);
  }

  return createPortal(
    <Modal
      title={section === "PREMIX" ? `Booking Tanki - ${label}` : `Booking Tanki — ${label}`}
      onClose={onClose}
      width={720}
      closeOnBackdropClick={false}
    >
      <ExcelBlock title={`Production & MRP Schedule » ${label}, Booking Tanki`}>
        <ExcelRow>
          <ExcelField label="Order">
            <input value={ev.order} readOnly />
          </ExcelField>
          <ExcelField label="Material Number *">
            <input value={materialNumber} onChange={(e) => setMaterialNumber(e.target.value)} disabled={readOnly} />
          </ExcelField>
          <ExcelField label="Material Description *">
            <input value={materialDescription} onChange={(e) => setMaterialDescription(e.target.value)} disabled={readOnly} />
          </ExcelField>
        </ExcelRow>
        <ExcelRow>
          <ExcelField label="Batch *">
            <input value={batch} onChange={(e) => setBatch(e.target.value)} disabled={readOnly} />
          </ExcelField>
          <ExcelField label="Order Qty (KG) *">
            <input value={orderQty} onChange={(e) => setOrderQty(e.target.value)} disabled={readOnly} />
          </ExcelField>
          <ExcelField label="Plant *">
            <select value={plant} onChange={(e) => setPlant(e.target.value)} disabled={readOnly}>
              <option value="">-- Pilih Plant --</option>
              <option value="1101">1101</option>
              <option value="1201">1201</option>
            </select>
          </ExcelField>
        </ExcelRow>
        <ExcelRow>
          <ExcelField label="Code Tanki *">
            <TankSelect bare id="pwo-booking-tank" value={codeTanki} onChange={setCodeTanki} disabled={readOnly} />
          </ExcelField>
          <ExcelField label="IU Plant">
            <input value={iuPlant} readOnly />
          </ExcelField>
          <ExcelField label="Rencana Mulai">
            <input
              type="datetime-local"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
              disabled={readOnly}
            />
          </ExcelField>
        </ExcelRow>
        <ExcelRow>
          <ExcelField label="Booked By">
            <input value={bookedByLabel} readOnly />
          </ExcelField>
          <ExcelField label="Catatan">
            <input value={note} onChange={(e) => setNote(e.target.value)} disabled={readOnly} />
          </ExcelField>
        </ExcelRow>
      </ExcelBlock>
      {readOnly && (
        <p style={{ margin: "10px 0 0", fontSize: "0.78rem", color: "#92400e" }}>
          ⚠ Akses View-only utk menu "Booking & Schedule Tanki" -- hanya bisa melihat, tidak bisa menyimpan.
        </p>
      )}
      <p style={{ margin: "10px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
        * Wajib diisi: Material Number, Material Description, Batch, Order Qty (KG), Plant, Code Tanki, Rencana
        Mulai. Material Number/Material Description/Batch/Order Qty (KG)/Plant otomatis terisi dari Referensi
        Order/PO kalau Order-nya ketemu -- kalau belum, isi manual. IU Plant otomatis terisi dari Master Data »
        Daftar Code Tanki begitu Code Tanki dipilih. Tanki langsung tampil "Terisi" (sumber Booking) di Tank
        Monitoring dengan Order ini, dan gugur otomatis begitu Order ini di-input di tahap {label} atau tanki
        dipakai Order lain. Mengubah Rencana Mulai ikut memindahkan kartu ini ke tanggal tersebut di Kalender (sama
        seperti menarik kartu ke hari lain).
      </p>
      {bookingsLoading && <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Memuat booking...</p>}
      {error && (
        <p className="error-text" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {/* Peringatan tanki sudah dibooking Order lain (2026-11-10) -- lihat
          komentar `conflict` di atas. */}
      {conflict && (
        <div style={{ margin: "8px 0 0", padding: "8px 10px", borderRadius: 6, background: "#fef3c7", color: "#92400e", fontSize: "0.82rem" }}>
          ⚠ Tanki {codeTanki.trim()} masih dibooking aktif oleh Order {conflict.order}
          {conflict.plannedStart ? ` (rencana mulai ${formatDateTime(conflict.plannedStart)})` : ""}. Tetap lanjutkan juga?
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="button" className="btn" style={{ padding: "4px 10px" }} disabled={readOnly} onClick={() => saveMutation.mutate(true)}>
              Tetap Lanjutkan
            </button>
            <button type="button" className="btn btn-outline" style={{ padding: "4px 10px" }} onClick={() => setConflict(null)}>
              Batal
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          disabled={readOnly || saveMutation.isPending}
          title={readOnly ? "Akses View-only utk Booking & Schedule Tanki -- tidak bisa menyimpan." : undefined}
          onClick={submit}
        >
          {saveMutation.isPending ? "Menyimpan..." : existing ? "Simpan Perubahan" : "Simpan Booking"}
        </button>
      </div>
    </Modal>,
    document.body
  );
}
