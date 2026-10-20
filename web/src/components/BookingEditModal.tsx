import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Modal from "./Modal";
import TankSelect from "./TankSelect";
import { ExcelBlock, ExcelRow, ExcelField } from "./ExcelGrid";
import { formatInputBy, useEmployeeOptions } from "./EmployeeNameSelect";
import type { OrderRefData } from "./OrderLookup";
import { toDateTimeLocalValue } from "../lib/datetime";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { ScheduleEvent } from "./WeeklyScheduleCalendar";

interface BookingRow {
  id: string;
  codeTanki: string;
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
}: {
  ev: ScheduleEvent;
  section: "PREMIX" | "AFTERMIX";
  onClose: () => void;
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
  const [note, setNote] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [error, setError] = useState("");

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
      setNote(noteFromRemark(existing.remark, prefix));
      setPlannedStart(toDateTimeLocalValue(existing.plannedStart));
    } else {
      setPlannedStart(toDateTimeLocalValue(ev.scheduledDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, existing?.plannedStart, existing?.codeTanki, existing?.remark]);

  const bookedByLabel = existing
    ? existing.inputByName ?? existing.inputBy
    : user
      ? (() => {
          const formatted = formatInputBy(employees, user.nik);
          return formatted === user.nik ? `${user.name} (${user.nik})` : formatted;
        })()
      : "-";

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (existing) {
        return api.put(`/tank-manual-input/booking/${existing.id}`, {
          codeTanki: codeTanki.trim(),
          note: note.trim() || undefined,
          plannedStart: plannedStart || undefined,
        });
      }
      return api.post("/tank-manual-input/booking", {
        section,
        codeTanki: codeTanki.trim(),
        order: ev.order,
        materialNumber: ref?.materialNumber ?? ev.materialNumber ?? undefined,
        materialDescription: ref?.materialDescription ?? ev.materialDescription ?? undefined,
        batch: ref?.batch ?? ev.batch ?? undefined,
        orderQty: ref?.orderQty ?? undefined,
        note: note.trim() || undefined,
        plannedStart: plannedStart || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] });
      queryClient.invalidateQueries({ queryKey: ["tank-status"] });
      queryClient.invalidateQueries({ queryKey: ["tank-booking-list", ev.order] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan booking tanki."),
  });

  function submit() {
    setError("");
    if (!codeTanki.trim()) {
      setError("Code Tanki wajib diisi.");
      return;
    }
    saveMutation.mutate();
  }

  return createPortal(
    <Modal title={`Booking Tanki ${label} — Order ${ev.order}`} onClose={onClose} width={720} closeOnBackdropClick={false}>
      <ExcelBlock title={`Production & MRP Schedule » ${label}, Booking Tanki`}>
        <ExcelRow>
          <ExcelField label="Order">
            <input value={ev.order} readOnly />
          </ExcelField>
          <ExcelField label="Material Number">
            <input value={ref?.materialNumber ?? ev.materialNumber ?? ""} readOnly />
          </ExcelField>
          <ExcelField label="Material Description">
            <input value={ref?.materialDescription ?? ev.materialDescription ?? ""} readOnly />
          </ExcelField>
        </ExcelRow>
        <ExcelRow>
          <ExcelField label="Batch">
            <input value={ref?.batch ?? ev.batch ?? ""} readOnly />
          </ExcelField>
          <ExcelField label="Order Qty">
            <input value={ref?.orderQty ?? ""} readOnly />
          </ExcelField>
          <ExcelField label="Plant">
            <input value={ref?.plant ?? ""} readOnly />
          </ExcelField>
        </ExcelRow>
        <ExcelRow>
          <ExcelField label="Code Tanki *">
            <TankSelect bare id="pwo-booking-tank" value={codeTanki} onChange={setCodeTanki} />
          </ExcelField>
          <ExcelField label="Rencana Mulai">
            <input
              type="datetime-local"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
            />
          </ExcelField>
          <ExcelField label="Booked By">
            <input value={bookedByLabel} readOnly />
          </ExcelField>
        </ExcelRow>
        <ExcelRow>
          <ExcelField label="Catatan">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </ExcelField>
        </ExcelRow>
      </ExcelBlock>
      <p style={{ margin: "10px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
        * Wajib diisi. Tanki langsung tampil "Terisi" (sumber Manual) di Tank Monitoring dengan Order ini, dan gugur
        otomatis begitu Order ini di-input di tahap {label} atau tanki dipakai Order lain. Mengubah Rencana Mulai ikut
        memindahkan kartu ini ke tanggal tersebut di Kalender (sama seperti menarik kartu ke hari lain).
      </p>
      {bookingsLoading && <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Memuat booking...</p>}
      {error && (
        <p className="error-text" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className="btn" disabled={saveMutation.isPending} onClick={submit}>
          {saveMutation.isPending ? "Menyimpan..." : existing ? "Simpan Perubahan" : "Simpan Booking"}
        </button>
      </div>
    </Modal>,
    document.body
  );
}
