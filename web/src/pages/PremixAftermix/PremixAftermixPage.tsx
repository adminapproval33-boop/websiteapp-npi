import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, pointerWithin, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import EmployeeNameSelect, { formatInputBy, isKnownEmployeeName, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import DataTable from "../../components/DataTable";
import WeeklyScheduleCalendar, {
  ScheduleEvent,
  buildEventDragId,
  dateKeyFromIso,
  parseDayDropId,
  parseInsertBeforeId,
} from "../../components/WeeklyScheduleCalendar";
import Modal from "../../components/Modal";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { computeQtyPerMan } from "../../lib/qty";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). */
const PREMIX_AFTERMIX_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 220,
  materialNumber: 200,
  materialDescription: 260,
  batch: 160,
  orderQty: 140,
  plant: 120,
  iuPlant: 160,
  codeTanki: 160,
  formReceived: 190,
  start: 190,
  finish: 190,
  spvProduksi: 180,
  leader: 180,
  qtyPerMan: 160,
  member: 180,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const PREMIX_AFTERMIX_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription"],
  ["batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki", "formReceived", "start", "finish"],
  ["spvProduksi", "leader", "qtyPerMan"],
  ["member"],
];

type Section = "PREMIX" | "AFTERMIX";

/** Baris antrian "PWO Schedule & Queue" -- khusus AFTERMIX, sumbernya History
 * Milling (bukan History Aftermix sendiri), lihat GET /premix-aftermix/aftermix-pwo-queue. */
interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string;
  codeTanki1: string | null;
  codeTanki2: string | null;
  codeMesin: string | null;
  spvProduksi: string;
  leader: string | null;
  members: string[] | null;
  qtyAct: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string;
  remark: string | null;
}

/** Baris antrian "PWO Schedule & Queue" -- khusus PREMIX, sumbernya Master
 * Data Cooispi (Referensi Order/PO SAP-COOISPI), BUKAN History tahap
 * sebelumnya (Premix tahap pertama, tidak punya tahap sebelumnya) -- lihat
 * GET /premix-aftermix/premix-pwo-queue (2026-07-29). Cuma field referensi
 * dasar (belum ada data crew/tanki/tanggal krn belum pernah diproses sama
 * sekali). */
interface PremixQueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  /** Terisi kalau Order ini sudah py baris Premix Form-Received-only (Start
   * belum diisi) -- Order itu TETAP di antrian ini sampai Start terisi,
   * lihat GET /premix-aftermix/premix-pwo-queue (direvisi 2026-07-30). */
  formReceived: string | null;
}

interface LogRow {
  id: number;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  spvProduksi: string;
  members: string[] | null;
  qtyPerMan: string | null;
  start: string | null;
  leader: string | null;
  finish: string | null;
  codeTanki: string;
  formReceived: string | null;
  remark: string | null;
  inputBy: string;
  attachments: { id: number; fileName: string; filePath: string }[];
}

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  spvProduksi: "",
  members: [] as string[],
  qtyPerMan: "",
  start: "",
  leader: "",
  finish: "",
  codeTanki: "",
  formReceived: "",
  remark: "",
};

/** Info minimal 1 Order antrian yg dibutuhkan utk drag-drop penjadwalan
 * (2026-08-05, instruksi eksplisit user) -- subset field yg sama-sama ada di
 * `PremixQueueRow` maupun `QueueRow` (AFTERMIX). */
interface DraggableQueueInfo {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
}

/** 1 "chip" Order yg bisa di-drag dari strip Queue ke grid Kalender
 * (2026-08-05, instruksi eksplisit user, revisi dari versi awal klik tombol
 * "Jadwalkan" 2026-08-04). ID drag-nya `queue:<order>` -- unik per Order,
 * beda namespace dari ID kartu jadwal yg sudah ada (`event:<id>`, lihat
 * WeeklyScheduleCalendar.tsx) supaya onDragEnd bisa bedakan "Order baru dari
 * Queue" vs "kartu lama yg mau di-reschedule" lewat `active.data.current.type`. */
function buildQueueDragId(order: string): string {
  return `queue:${order}`;
}

function DraggableQueueChip({
  row,
  selected,
  onToggleSelect,
}: {
  row: DraggableQueueInfo;
  selected: boolean;
  onToggleSelect: (dragId: string, e: ReactMouseEvent) => void;
}) {
  const dragId = buildQueueDragId(row.order);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { type: "queue" as const, row },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => onToggleSelect(dragId, e)}
      title={`${row.order} — ${row.materialDescription ?? ""} (tarik ke Kalender utk menjadwalkan, Ctrl+Klik utk pilih banyak sekaligus)`}
      style={{
        flex: "0 0 auto",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "6px 10px",
        background: "var(--panel-bg, #fff)",
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.4 : 1,
        boxShadow: selected ? "0 0 0 2px #4338ca" : undefined,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        maxWidth: 200,
      }}
    >
      <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--navy-dark)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.order}
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.materialDescription ?? row.batch ?? ""}
      </div>
    </div>
  );
}

export default function PremixAftermixPage({
  section,
  title,
  embedded = false,
  initialOrder,
  onSaved,
}: {
  section: Section;
  title: string;
  /** Mode ringkas dipakai pop-up "Tahap Selanjutnya" di Production Order
   * Monitoring (2026-07-31, instruksi eksplisit user) -- sembunyikan
   * tab-switcher History/PWO Queue, cuma tampilkan form Input. Halaman biasa
   * (/planning/premix, /planning/aftermix) TIDAK pakai prop ini sama sekali,
   * jadi perilakunya tidak berubah. */
  embedded?: boolean;
  /** Order yg langsung di-lookup otomatis begitu komponen ini mount --
   * dipakai bareng `embedded`, meniru persis apa yg terjadi kalau user
   * ngetik Order lalu Enter/blur di OrderLookup biasa. */
  initialOrder?: string;
  /** Dipanggil SETELAH save sukses (di luar behavior normal spt setMessage) --
   * dipakai pop-up utk nutup diri sendiri & refresh Dashboard. */
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const isViewOnly = getMenuLevel(user, section === "PREMIX" ? "premix" : "aftermix") === "VIEW";
  const { data: employees } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history" | "queue">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memberNameInput, setMemberNameInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    PREMIX_AFTERMIX_COL_DEFAULT_WIDTHS,
    `premixAftermixColWidths-${section}`,
    PREMIX_AFTERMIX_COL_ROWS
  );

  const historyQuery = useQuery({
    queryKey: ["premix-aftermix-history", section],
    queryFn: () =>
      api.get<{ success: boolean; data: LogRow[] }>(`/premix-aftermix/history?section=${section}`).then((r) => r.data),
    // Mode "embedded" (pop-up "Tahap Selanjutnya", 2026-07-31) cuma
    // nampilin form Input, History/Queue tidak pernah dirender -- jadi tidak
    // perlu ikut fetch percuma di background.
    enabled: !embedded,
  });

  // Antrian "PWO Schedule & Queue" AFTERMIX (sumbernya History Milling) --
  // sengaja `enabled: section === "AFTERMIX"` supaya halaman Premix tidak
  // ikut fetch endpoint ini percuma.
  const queueQuery = useQuery({
    queryKey: ["aftermix-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/premix-aftermix/aftermix-pwo-queue").then((r) => r.data),
    enabled: !embedded && section === "AFTERMIX",
  });

  // Antrian "PWO Schedule & Queue" PREMIX (sumbernya Master Data Cooispi,
  // BUKAN History tahap sebelumnya -- Premix tahap pertama), lihat GET
  // /premix-aftermix/premix-pwo-queue (2026-07-29). `enabled: section ===
  // "PREMIX"` supaya halaman Aftermix tidak ikut fetch endpoint ini percuma.
  const premixQueueQuery = useQuery({
    queryKey: ["premix-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: PremixQueueRow[] }>("/premix-aftermix/premix-pwo-queue").then((r) => r.data),
    enabled: !embedded && section === "PREMIX",
  });

  // Kalender mingguan "PWO Schedule & Queue" (2026-08-04, instruksi eksplisit
  // user, niru referensi Dribbble "Task Management Dashboard Schedule
  // Experience") -- TAMBAHAN di samping tabel antrian yg sudah ada (toggle
  // List/Kalender), bukan pengganti. Versi awal: klik tombol "Jadwalkan" ->
  // modal pilih tanggal & jam. 2026-08-05 DISEDERHANAKAN (instruksi eksplisit
  // user: "menu jam tidak perlu, cukup list & nomor urutan") jadi drag-drop
  // Queue -> hari (tanpa jam), modal "Jadwalkan" TETAP ada sbg alternatif
  // non-drag tapi cuma pilih tanggal.
  const [queueView, setQueueView] = useState<"list" | "calendar">("list");
  const [scheduleTarget, setScheduleTarget] = useState<{
    order: string;
    materialNumber: string | null;
    materialDescription: string | null;
    batch: string | null;
  } | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  const pwoScheduleQuery = useQuery({
    queryKey: ["pwo-schedule", section],
    queryFn: () => api.get<{ success: boolean; data: ScheduleEvent[] }>(`/premix-aftermix/pwo-schedule?section=${section}`).then((r) => r.data),
    enabled: !embedded,
  });

  /** Order yg sudah punya jadwal (muncul di Kalender) -- dipakai supaya strip
   * Queue di mode Kalender TIDAK lagi menampilkan Order yg sudah dijadwalkan
   * (2026-08-05, instruksi eksplisit user: sebelumnya Order yg sudah
   * dijadwalkan tetap kelihatan di strip atas, bikin bingung dikira ada
   * batasan jumlah). Cuma memfilter strip drag-chip, BUKAN tabel List biasa
   * (List tetap tampilkan semua antrian apa adanya, krn dipakai jg utk aksi
   * lain spt "Input Premix"/"Input Aftermix" yg tidak terkait status jadwal). */
  const scheduledOrders = useMemo(() => new Set((pwoScheduleQuery.data ?? []).map((e) => e.order)), [pwoScheduleQuery.data]);

  const scheduleMutation = useMutation({
    mutationFn: () => {
      if (!scheduleTarget) return Promise.reject(new Error("Tidak ada Order yang dipilih."));
      return api.post("/premix-aftermix/pwo-schedule", {
        order: scheduleTarget.order,
        section,
        materialNumber: scheduleTarget.materialNumber ?? "",
        materialDescription: scheduleTarget.materialDescription ?? "",
        batch: scheduleTarget.batch ?? "",
        scheduledDate: scheduleDate,
      });
    },
    onSuccess: () => {
      setScheduleError("");
      setScheduleTarget(null);
      queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] });
    },
    onError: (err) => setScheduleError(err instanceof ApiError ? err.message : "Gagal menyimpan jadwal."),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/premix-aftermix/pwo-schedule/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] }),
  });

  // Reorder dalam 1 hari (tombol ▲▼ di WeeklyScheduleCalendar, 2026-08-05) --
  // kirim urutan ID final utk 1 hari sekaligus ke PUT /pwo-schedule/reorder.
  const reorderMutation = useMutation({
    mutationFn: (payload: { scheduledDate: string; orderedIds: string[] }) =>
      api.put("/premix-aftermix/pwo-schedule/reorder", { section, ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] }),
    onError: (err) => setScheduleError(err instanceof ApiError ? err.message : "Gagal menyimpan urutan."),
  });

  function handleReorderDay(dayEvents: ScheduleEvent[]) {
    if (dayEvents.length === 0) return;
    reorderMutation.mutate({ scheduledDate: dayEvents[0].scheduledDate, orderedIds: dayEvents.map((e) => e.id) });
  }

  // Drag-drop penjadwalan (2026-08-05, instruksi eksplisit user, revisi dari
  // versi awal "klik tombol Jadwalkan" 2026-08-04) -- reuse endpoint POST yg
  // SAMA dgn scheduleMutation di atas (upsert by order+section, jadi
  // otomatis jadi "pindah hari" kalau Order-nya sudah py jadwal). Mutation
  // terpisah (bukan pakai scheduleMutation) krn sumber datanya beda (payload
  // eksplisit dari drag event, bukan dari scheduleTarget/scheduleDate state
  // punya form modal).
  type ActiveDragInfo =
    | { kind: "single"; order: string; materialDescription: string | null; batch: string | null }
    | { kind: "multi"; count: number };
  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Multi-select Ctrl+Klik (2026-08-05, instruksi eksplisit user: pilih
  // beberapa Order sekaligus lalu drag bareng) -- key-nya SAMA PERSIS dgn ID
  // drag dnd-kit (`queue:<order>` / `event:<id>`, lihat buildQueueDragId &
  // WeeklyScheduleCalendar.buildEventDragId), jadi onDragStart/onDragEnd
  // tinggal cek `selectedIds.has(String(active.id))` tanpa perlu mapping id
  // terpisah. Lintas strip Queue MAUPUN kartu kalender -- boleh campur.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(dragId: string, e: ReactMouseEvent) {
    if (!e.ctrlKey) return; // klik biasa (tanpa Ctrl) tidak melakukan apa-apa di kartu/chip ini
    e.preventDefault();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(dragId)) next.delete(dragId);
      else next.add(dragId);
      return next;
    });
  }

  const dragScheduleMutation = useMutation({
    mutationFn: (payload: {
      order: string;
      materialNumber: string | null;
      materialDescription: string | null;
      batch: string | null;
      scheduledDate: string;
    }) =>
      api.post<{ success: boolean; data: ScheduleEvent }>("/premix-aftermix/pwo-schedule", {
        order: payload.order,
        section,
        materialNumber: payload.materialNumber ?? "",
        materialDescription: payload.materialDescription ?? "",
        batch: payload.batch ?? "",
        scheduledDate: payload.scheduledDate,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] }),
    onError: (err) => setScheduleError(err instanceof ApiError ? err.message : "Gagal menjadwalkan lewat drag-drop."),
  });

  function handleDragStart(evt: DragStartEvent) {
    const data = evt.active.data.current as { type: "queue"; row: DraggableQueueInfo } | { type: "scheduled"; event: ScheduleEvent } | undefined;
    if (!data) return;
    const draggedId = String(evt.active.id);
    if (selectedIds.has(draggedId) && selectedIds.size > 1) {
      // Kartu/chip yg di-drag adalah bagian dari seleksi Ctrl+Klik yg py
      // >1 anggota -- SEMUANYA ikut dipindah bareng (2026-08-05, instruksi
      // eksplisit user). Kalau yg di-drag BUKAN bagian seleksi (atau
      // seleksi cuma 1), perilakunya balik ke drag 1-item biasa spt
      // sebelumnya -- seleksi yg ada dibiarkan apa adanya, tidak direset.
      setActiveDrag({ kind: "multi", count: selectedIds.size });
    } else {
      const src = data.type === "queue" ? data.row : data.event;
      setActiveDrag({ kind: "single", order: src.order, materialDescription: src.materialDescription, batch: src.batch });
    }
  }

  /** Hitung urutan ID final utk 1 hari, dgn `movedIds` (1 ATAU BEBERAPA
   * item sekaligus, 2026-08-05 instruksi eksplisit user: pilih banyak Order
   * lalu drag bareng -- urutan relatif ANTAR item yg dipindah mengikuti
   * urutan array `movedIds`) disisipkan TEPAT SEBELUM `insertBeforeId`
   * (kalau ada) atau di paling akhir (kalau tidak ada, mis. drop di area
   * kosong kolom, bukan di atas kartu tertentu). `allEvents` HARUS data
   * SEBELUM drag ini (state lama, bukan hasil refetch) -- perhitungan di
   * sini murni lokal/optimistic. */
  function computeInsertOrderMulti(allEvents: ScheduleEvent[], targetDateKey: string, movedIds: string[], insertBeforeId: string | null): string[] {
    const movedSet = new Set(movedIds);
    const dayIds = allEvents
      .filter((e) => dateKeyFromIso(e.scheduledDate) === targetDateKey && !movedSet.has(e.id))
      .sort((a, b) => a.sequence - b.sequence)
      .map((e) => e.id);
    const insertAt = insertBeforeId ? dayIds.indexOf(insertBeforeId) : -1;
    dayIds.splice(insertAt === -1 ? dayIds.length : insertAt, 0, ...movedIds);
    return dayIds;
  }

  /** Pindahkan BEBERAPA item sekaligus (hasil seleksi Ctrl+Klik, 2026-08-05
   * instruksi eksplisit user) ke `targetDateKey`, tersisip sebelum
   * `insertBeforeId` kalau ada. POST dikirim SATU-SATU berurutan (di-await,
   * BUKAN Promise.all paralel) -- server menghitung sequence berikutnya
   * lewat query "sequence max saat ini" (lihat POST /pwo-schedule di
   * premixAftermix.routes.ts), jadi kalau dikirim paralel ke hari yg SAMA,
   * 2 request bisa saling baca sequence lama satu sama lain sebelum salah
   * satunya commit & berebut angka yg sama -- berurutan menghindari itu
   * (agak lebih lambat utk banyak item sekaligus, tapi tetap benar). Ditutup
   * dgn 1x panggilan reorder final utk urutan yg presisi (bukan cuma
   * ke-append). */
  async function runMultiMove(ids: string[], allEvents: ScheduleEvent[], targetDateKey: string, insertBeforeId: string | null) {
    const queueSource = section === "AFTERMIX" ? filteredQueue : filteredPremixQueue;
    type Item = { id: string; kind: "queue"; row: DraggableQueueInfo } | { id: string; kind: "scheduled"; event: ScheduleEvent };
    const items: Item[] = [];
    for (const dragId of ids) {
      if (dragId.startsWith("queue:")) {
        const order = dragId.slice("queue:".length);
        const row = queueSource.find((r) => r.order === order);
        if (row) items.push({ id: dragId, kind: "queue", row });
      } else {
        const ev = allEvents.find((e) => buildEventDragId(e.id) === dragId);
        if (ev) items.push({ id: dragId, kind: "scheduled", event: ev });
      }
    }
    if (items.length === 0) return;

    try {
      const finalIds: string[] = [];
      for (const item of items) {
        if (item.kind === "queue") {
          const res = await api.post<{ success: boolean; data: ScheduleEvent }>("/premix-aftermix/pwo-schedule", {
            order: item.row.order,
            section,
            materialNumber: item.row.materialNumber ?? "",
            materialDescription: item.row.materialDescription ?? "",
            batch: item.row.batch ?? "",
            scheduledDate: targetDateKey,
          });
          finalIds.push(res.data.id);
        } else {
          const sourceDateKey = dateKeyFromIso(item.event.scheduledDate);
          if (sourceDateKey !== targetDateKey) {
            await api.post("/premix-aftermix/pwo-schedule", {
              order: item.event.order,
              section,
              materialNumber: item.event.materialNumber ?? "",
              materialDescription: item.event.materialDescription ?? "",
              batch: item.event.batch ?? "",
              scheduledDate: targetDateKey,
            });
          }
          finalIds.push(item.event.id);
        }
      }
      const orderedIds = computeInsertOrderMulti(allEvents, targetDateKey, finalIds, insertBeforeId);
      await api.put("/premix-aftermix/pwo-schedule/reorder", { section, scheduledDate: targetDateKey, orderedIds });
      setScheduleError("");
      setSelectedIds(new Set());
    } catch (err) {
      setScheduleError(err instanceof ApiError ? err.message : "Gagal memindahkan beberapa Order sekaligus.");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["pwo-schedule", section] });
    }
  }

  function handleDragEnd(evt: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = evt;
    if (!over) return; // dilepas di luar kolom hari -- batal, tidak berubah apa2
    const data = active.data.current as { type: "queue"; row: DraggableQueueInfo } | { type: "scheduled"; event: ScheduleEvent } | undefined;
    if (!data) return;

    // Drop bisa kena 2 jenis target: latar kolom hari (day:<tanggal>, artinya
    // "taruh di paling bawah hari ini") ATAU tepat di atas 1 kartu
    // (insertBefore:<id>, artinya "sisip SEBELUM kartu itu", 2026-08-05
    // instruksi eksplisit user). `pointerWithin` di DndContext (bukan
    // rectIntersection bawaan) SENGAJA dipakai spy target kartu yg lebih
    // kecil & bersarang di dalam kolom hari tetap kepilih drpd kolom
    // besarnya kalau pointer pas di atas kartu itu.
    const dayDrop = parseDayDropId(String(over.id));
    const insertBeforeId = dayDrop ? null : parseInsertBeforeId(String(over.id));
    let targetDateKey: string;
    if (dayDrop) {
      targetDateKey = dayDrop.dateKey;
    } else if (insertBeforeId) {
      const targetEvent = (pwoScheduleQuery.data ?? []).find((e) => e.id === insertBeforeId);
      if (!targetEvent) return;
      targetDateKey = dateKeyFromIso(targetEvent.scheduledDate);
    } else {
      return;
    }

    const allEvents = pwoScheduleQuery.data ?? [];

    // Multi-select (2026-08-05, instruksi eksplisit user): kalau kartu/chip
    // yg di-drag adalah bagian dari seleksi Ctrl+Klik yg py >1 anggota,
    // SEMUA anggota seleksi ikut dipindah bareng lewat runMultiMove --
    // jalur di bawah ini (drag 1-item) dilewati sepenuhnya.
    const draggedId = String(active.id);
    if (selectedIds.has(draggedId) && selectedIds.size > 1) {
      void runMultiMove(Array.from(selectedIds), allEvents, targetDateKey, insertBeforeId);
      return;
    }

    if (data.type === "queue") {
      // Order baru dari Queue -- POST dulu (server append ke akhir hari
      // target & kasih id resmi), BARU kalau perlu disisip di posisi
      // tertentu (bukan cuma append), susul dgn reorder memindahkan id itu
      // ke posisi yg benar.
      dragScheduleMutation.mutate(
        {
          order: data.row.order,
          materialNumber: data.row.materialNumber,
          materialDescription: data.row.materialDescription,
          batch: data.row.batch,
          scheduledDate: targetDateKey,
        },
        {
          onSuccess: (res) => {
            if (!insertBeforeId) return;
            const orderedIds = computeInsertOrderMulti(allEvents, targetDateKey, [res.data.id], insertBeforeId);
            reorderMutation.mutate({ scheduledDate: targetDateKey, orderedIds });
          },
        }
      );
      return;
    }

    // Kartu yg sudah ada di-drag.
    const sourceDateKey = dateKeyFromIso(data.event.scheduledDate);
    if (sourceDateKey === targetDateKey) {
      // Masih di hari yg SAMA -- reorder murni lokal, tidak perlu POST sama sekali.
      if (data.event.id === insertBeforeId) return; // drop tepat di kartu-nya sendiri -- no-op
      const orderedIds = computeInsertOrderMulti(allEvents, targetDateKey, [data.event.id], insertBeforeId);
      reorderMutation.mutate({ scheduledDate: targetDateKey, orderedIds });
    } else {
      // Pindah ke hari lain -- POST dulu (append ke akhir hari baru), baru
      // reorder kalau perlu disisip, sama pola dgn Order baru dari Queue.
      dragScheduleMutation.mutate(
        {
          order: data.event.order,
          materialNumber: data.event.materialNumber,
          materialDescription: data.event.materialDescription,
          batch: data.event.batch,
          scheduledDate: targetDateKey,
        },
        {
          onSuccess: () => {
            if (!insertBeforeId) return;
            const orderedIds = computeInsertOrderMulti(allEvents, targetDateKey, [data.event.id], insertBeforeId);
            reorderMutation.mutate({ scheduledDate: targetDateKey, orderedIds });
          },
        }
      );
    }
  }

  function openScheduleModal(target: { order: string; materialNumber: string | null; materialDescription: string | null; batch: string | null }) {
    setScheduleTarget(target);
    setScheduleDate("");
    setScheduleError("");
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { section, ...form };
      return editingId
        ? api.put<{ success: boolean; data: LogRow }>(`/premix-aftermix/${editingId}`, payload)
        : api.post<{ success: boolean; data: LogRow }>("/premix-aftermix", payload);
    },
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["premix-aftermix-history", section] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data berhasil diperbarui." : "Data berhasil disimpan.");
      }
      onSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/premix-aftermix/${id}`),
    onSuccess: () => {
      setMessage("Data berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["premix-aftermix-history", section] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/premix-aftermix/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["premix-aftermix-history", section] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => {
      const orderQty = data.orderQty ?? "";
      return {
        ...f,
        materialNumber: data.materialNumber ?? "",
        materialDescription: data.materialDescription ?? "",
        batch: data.batch ?? "",
        orderQty,
        plant: data.plant ?? "",
        qtyPerMan: computeQtyPerMan(orderQty, f.members.length),
      };
    });
    try {
      const res = await api.get<{ success: boolean; data: { iuPlant: string; codeTanki: string } | null }>(
        `/master-data/order-context/${encodeURIComponent(data.order)}`
      );
      if (res.data) {
        setForm((f) => ({
          ...f,
          iuPlant: res.data!.iuPlant || f.iuPlant,
          codeTanki: res.data!.codeTanki || f.codeTanki,
        }));
      }
    } catch {
      /* saran IU Plant/Code Tanki bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
    // Kolom lain (SPV Produksi, Leader, Member, Start, Finish, Remark) diambil
    // dari input TERAKHIR untuk Order ini DI MODUL YANG SAMA (bukan lintas
    // modul) -- Remark SENGAJA tidak ikut disarankan dari order-context lintas
    // modul di atas, supaya tiap proses punya Remark sendiri-sendiri.
    try {
      const latestRes = await api.get<{ success: boolean; data: LogRow | null }>(
        `/premix-aftermix/latest-by-order/${encodeURIComponent(data.order)}?section=${section}`
      );
      const latest = latestRes.data;
      if (latest) {
        // Order ini sudah pernah diinput -- masuk mode Edit record yang sama
        // (bukan bikin baris baru) supaya History tetap 1 baris per Order:
        // data baru akan menimpa/replace data lama saat Save.
        setEditingId(latest.id);
        setForm((f) => {
          const members = f.members.length > 0 ? f.members : latest.members ?? [];
          return {
            ...f,
            spvProduksi: f.spvProduksi || latest.spvProduksi || "",
            leader: f.leader || latest.leader || "",
            members,
            start: f.start || latest.start || "",
            finish: f.finish || latest.finish || "",
            formReceived: f.formReceived || latest.formReceived || "",
            remark: f.remark || latest.remark || "",
            qtyPerMan: computeQtyPerMan(f.orderQty, members.length),
          };
        });
      } else {
        setEditingId(null);
      }
    } catch {
      /* belum ada input sebelumnya untuk Order ini -- biarkan kosong */
    }
  }

  // Mode pop-up "Tahap Selanjutnya" (embedded+initialOrder) -- meniru PERSIS
  // apa yg terjadi kalau user ngetik Order lalu Enter/blur di OrderLookup
  // biasa, supaya tidak perlu ngetik ulang Order-nya.
  useEffect(() => {
    if (!embedded || !initialOrder) return;
    setForm((f) => ({ ...f, order: initialOrder }));
    api
      .get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(initialOrder)}`)
      .then((res) => handleOrderFound(res.data))
      .catch(() => {
        /* Order tidak ditemukan di Master Data -- biarkan kosong, user isi manual */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialOrder]);

  function handleOrderQtyChange(orderQty: string) {
    setForm((f) => ({ ...f, orderQty, qtyPerMan: computeQtyPerMan(orderQty, f.members.length) }));
  }

  function addMember() {
    const name = memberNameInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    setError("");
    setForm((f) => {
      const members = [...f.members, name];
      return { ...f, members, qtyPerMan: computeQtyPerMan(f.orderQty, members.length) };
    });
    setMemberNameInput("");
  }

  function removeLastMember() {
    setForm((f) => {
      const members = f.members.slice(0, -1);
      return { ...f, members, qtyPerMan: computeQtyPerMan(f.orderQty, members.length) };
    });
  }

  function startEdit(row: LogRow) {
    setEditingId(row.id);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch,
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      spvProduksi: row.spvProduksi,
      members: row.members ?? [],
      qtyPerMan: row.qtyPerMan ?? "",
      start: row.start ?? "",
      leader: row.leader ?? "",
      finish: row.finish ?? "",
      codeTanki: row.codeTanki,
      formReceived: row.formReceived ?? "",
      remark: row.remark ?? "",
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  /** Isi Order dari PWO Schedule & Queue ke form Input Premix/Aftermix (lewat
   * alur handleOrderFound yg sama dgn ketik manual di OrderLookup) -- sama
   * pola dgn loadIntoInput di MillingPage.tsx. Parameter-nya SENGAJA dibuat
   * minimal (bukan QueueRow penuh) supaya bisa dipakai bareng utk baris
   * antrian Premix (PremixQueueRow, field-nya lebih sedikit) maupun Aftermix. */
  function loadIntoInput(row: {
    order: string;
    batch: string | null;
    materialNumber: string | null;
    materialDescription: string | null;
    orderQty: string | null;
    plant: string | null;
  }) {
    setForm((f) => ({ ...f, order: row.order }));
    handleOrderFound({
      order: row.order,
      batch: row.batch,
      materialNumber: row.materialNumber,
      materialDescription: row.materialDescription,
      orderQty: row.orderQty,
      plant: row.plant,
      // Premix/Aftermix tidak punya kolom Types of Products/Base Color/Volume
      // -- 3 field ini cuma dipakai Colour Matching & Packing.
      jenis: null,
      warnaDasar: null,
      volume: null,
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isKnownEmployeeName(employees, form.spvProduksi)) {
      setError("SPV Produksi tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownEmployeeName(employees, form.leader)) {
      setError("Leader tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    saveMutation.mutate();
  }

  const filteredHistory = (historyQuery.data ?? []).filter((row) =>
    search.trim() ? row.order.toLowerCase().includes(search.trim().toLowerCase()) : true
  );

  const filteredQueue = (queueQuery.data ?? []).filter((row) =>
    queueSearch.trim() ? row.order.toLowerCase().includes(queueSearch.trim().toLowerCase()) : true
  );

  const filteredPremixQueue = (premixQueueQuery.data ?? []).filter((row) =>
    queueSearch.trim() ? row.order.toLowerCase().includes(queueSearch.trim().toLowerCase()) : true
  );

  function findEmployee(name: string | null) {
    const trimmed = (name ?? "").trim().toLowerCase();
    if (!trimmed) return undefined;
    return (employees ?? []).find((e) => e.fullName.trim().toLowerCase() === trimmed);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          {!isViewOnly && (
            <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
              Input {title}
            </button>
          )}
          <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
            History
          </button>
          <button className={`btn ${tab === "queue" ? "" : "btn-outline"}`} onClick={() => setTab("queue")}>
            PWO Schedule &amp; Queue
          </button>
        </div>
      )}

      {(embedded || tab === "input") && (
        <div className="panel">
          <form className="panel-body" onSubmit={handleSubmit}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <ExcelBlock title={`Production & MRP Schedule » ${title}, Input Proses`}>
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")}>
                  <OrderLookup bare value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")}>
                  <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} />
                </ExcelField>
                <ExcelField label="Material Description" widthPx={colWidths.materialDescription} onResizeStart={beginResize("materialDescription")}>
                  <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Batch" widthPx={colWidths.batch} onResizeStart={beginResize("batch")}>
                  <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={colWidths.orderQty} onResizeStart={beginResize("orderQty")}>
                  <input value={form.orderQty} onChange={(e) => handleOrderQtyChange(e.target.value)} />
                </ExcelField>
                <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")}>
                  <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={colWidths.iuPlant} onResizeStart={beginResize("iuPlant")}>
                  <IuPlantSelect bare id={`${section}-iu-plant`} value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} required />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={colWidths.codeTanki} onResizeStart={beginResize("codeTanki")}>
                  <TankSelect bare id={`${section}-tank`} value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
                </ExcelField>
                <ExcelField label="Form Received" widthPx={colWidths.formReceived} onResizeStart={beginResize("formReceived")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.formReceived)}
                    onChange={(e) => setForm({ ...form, formReceived: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Start" widthPx={colWidths.start} onResizeStart={beginResize("start")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.start)}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Finish" widthPx={colWidths.finish} onResizeStart={beginResize("finish")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.finish)}
                    onChange={(e) => setForm({ ...form, finish: e.target.value })}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvProduksi} onResizeStart={beginResize("spvProduksi")}>
                  <EmployeeNameSelect bare id={`${section}-spv`} value={form.spvProduksi} onChange={(v) => setForm({ ...form, spvProduksi: v })} required />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leader} onResizeStart={beginResize("leader")}>
                  <EmployeeNameSelect bare id={`${section}-leader`} value={form.leader} onChange={(v) => setForm({ ...form, leader: v })} />
                </ExcelField>
                <ExcelField label="Qty/Man (Liter)" color="orange" widthPx={colWidths.qtyPerMan} onResizeStart={beginResize("qtyPerMan")}>
                  <input
                    value={form.qtyPerMan}
                    onChange={(e) => setForm({ ...form, qtyPerMan: e.target.value })}
                    title="Otomatis: Order Qty ÷ jumlah Member -- bisa diubah manual bila perlu"
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Member" widthPx={colWidths.member} onResizeStart={beginResize("member")}>
                  <EmployeeNameSelect bare id={`${section}-member`} value={memberNameInput} onChange={setMemberNameInput} placeholder="Nama anggota" />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <div className="excel-cell" style={{ flexBasis: "20%", maxWidth: "20%", flexDirection: "row", gap: 4, padding: 4 }}>
                  <button
                    type="button"
                    className="btn btn-info"
                    title="Tambah Member"
                    aria-label="Tambah Member"
                    style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
                    onClick={addMember}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    title="Kurangi Member"
                    aria-label="Kurangi Member"
                    style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
                    onClick={removeLastMember}
                    disabled={form.members.length === 0}
                  >
                    −
                  </button>
                </div>
              </ExcelRow>
              {form.members.length > 0 && (
                <ExcelRow>
                  <div className="excel-member-cell" style={{ flexBasis: "50%", maxWidth: "50%" }}>
                    <div className="excel-member-list">
                      {form.members.map((m, idx) => (
                        <span key={idx} className="excel-member-chip">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </ExcelRow>
              )}
            </ExcelBlock>

            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Remark</label>
                <button type="button" className="btn btn-info" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
                  Upload File
                </button>
                {attachmentFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachmentFile.name}</span>}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <textarea rows={5} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-success" type="submit" disabled={saveMutation.isPending || uploadMutation.isPending}>
                {saveMutation.isPending || uploadMutation.isPending ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Save Data"}
              </button>
              {editingId && (
                <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                  Batal Edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">History {title}</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: LogRow) => r.id}
              exportFileName={`history-${section.toLowerCase()}`}
              storageKey={`premix-aftermix-history-${section.toLowerCase()}`}
              rows={filteredHistory}
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
                { key: "spvProduksi", label: "SPV Produksi", render: (r) => r.spvProduksi },
                { key: "spvEmployeeId", label: "SPV Employee ID", render: (r) => findEmployee(r.spvProduksi)?.employeeId },
                { key: "leader", label: "Leader", render: (r) => r.leader },
                { key: "leaderEmployeeId", label: "Leader Employee ID", render: (r) => findEmployee(r.leader)?.employeeId },
                {
                  key: "members",
                  label: "Member",
                  render: (r) => {
                    const members = r.members ?? [];
                    const list = members.map((m) => {
                      const emp = findEmployee(m);
                      return emp ? `${m} (${emp.employeeId})` : m;
                    });
                    return [String(members.length), ...list].join(" | ");
                  },
                },
                { key: "qtyPerMan", label: "Qty/Man (Liter)", render: (r) => r.qtyPerMan },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
                {
                  key: "formReceived",
                  label: "Form Received",
                  render: (r) => (r.formReceived ? formatDateTime(r.formReceived) : ""),
                  csvValue: (r) => (r.formReceived ? toExcelDateTimeString(r.formReceived) : ""),
                },
                {
                  key: "start",
                  label: "Start",
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish",
                  render: (r) => (r.finish ? formatDateTime(r.finish) : ""),
                  csvValue: (r) => (r.finish ? toExcelDateTimeString(r.finish) : ""),
                },
                { key: "remark", label: "Remark", render: (r) => r.remark },
                { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
                { key: "attachments", label: "Lampiran", render: (r) => (r.attachments.length ? `${r.attachments.length} file` : "-") },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                        ✏️
                      </button>
                      {getMenuLevel(user, section === "PREMIX" ? "premix" : "aftermix") === "INPUT" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data ${title} untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
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

      {tab === "queue" && section === "AFTERMIX" && (
        <div className="panel">
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO yang sudah "Milling - DN" dan sedang menunggu dikerjakan Aftermix -- diurutkan Finish Milling
              paling awal duluan (FIFO). PWO otomatis hilang dari daftar ini begitu sudah ada input Aftermix utk
              PWO tersebut, atau begitu PWO itu sudah masuk tahap setelah Aftermix (Colour Matching, Approval,
              Packing).
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input
                placeholder="Cari nomor Order..."
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                style={{ padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button type="button" className={`btn ${queueView === "list" ? "" : "btn-outline"}`} onClick={() => setQueueView("list")}>
                  📋 List
                </button>
                <button type="button" className={`btn ${queueView === "calendar" ? "" : "btn-outline"}`} onClick={() => setQueueView("calendar")}>
                  📅 Kalender
                </button>
              </div>
            </div>

            {queueView === "calendar" ? (
              <DndContext sensors={dragSensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Tarik Order dari daftar di bawah ini ke kolom hari yang diinginkan di Kalender untuk menjadwalkan --
                  kartu yang sudah terjadwal juga bisa ditarik ke hari lain utk pindah, atau pakai ▲▼ di kartunya utk
                  ubah urutan. Order yang sudah dijadwalkan otomatis hilang dari daftar di bawah ini. Tahan{" "}
                  <strong>Ctrl</strong> lalu klik beberapa Order (di daftar di bawah maupun kartu di Kalender) untuk
                  pilih banyak sekaligus, lalu tarik salah satunya -- semuanya ikut pindah bareng.
                </p>
                {selectedIds.size > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: "0.78rem" }}>
                    <span style={{ color: "var(--navy-dark)", fontWeight: 700 }}>{selectedIds.size} Order dipilih</span>
                    <button type="button" className="btn btn-outline" style={{ padding: "2px 10px" }} onClick={() => setSelectedIds(new Set())}>
                      Batal Pilih
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 2px 10px", marginBottom: 4 }}>
                  {filteredQueue.filter((r) => !scheduledOrders.has(r.order)).map((r) => (
                    <DraggableQueueChip key={r.order} row={r} selected={selectedIds.has(buildQueueDragId(r.order))} onToggleSelect={toggleSelect} />
                  ))}
                  {filteredQueue.filter((r) => !scheduledOrders.has(r.order)).length === 0 && (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Semua antrian sudah dijadwalkan (atau antrian kosong).</span>
                  )}
                </div>
                <WeeklyScheduleCalendar
                  events={pwoScheduleQuery.data ?? []}
                  onDelete={(id) => deleteScheduleMutation.mutate(id)}
                  onReorderDay={handleReorderDay}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                />
                <DragOverlay>
                  {activeDrag && (
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        background: "#fff",
                        boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
                        maxWidth: 200,
                      }}
                    >
                      {activeDrag.kind === "multi" ? (
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--navy-dark)" }}>{activeDrag.count} Order dipilih</div>
                      ) : (
                        <>
                          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--navy-dark)" }}>{activeDrag.order}</div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{activeDrag.materialDescription ?? activeDrag.batch ?? ""}</div>
                        </>
                      )}
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            ) : (
            <DataTable
              rowKey={(r: QueueRow) => r.order}
              exportFileName="aftermix-pwo-schedule-queue"
              storageKey="aftermix-pwo-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki1", label: "Code Tanki 1 (Couple)", render: (r) => r.codeTanki1 },
                { key: "codeTanki2", label: "Code Tanki 2 (Moving)", render: (r) => r.codeTanki2 },
                { key: "codeMesin", label: "Code Mesin", render: (r) => r.codeMesin },
                { key: "spvProduksi", label: "SPV Produksi (Milling)", render: (r) => r.spvProduksi },
                { key: "leader", label: "Leader (Milling)", render: (r) => r.leader },
                {
                  key: "members",
                  label: "Member (Milling)",
                  render: (r) => (r.members ?? []).join(", "),
                },
                { key: "qtyAct", label: "Qty Act (Milling)", render: (r) => r.qtyAct },
                {
                  key: "start",
                  label: "Start Milling",
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish Milling",
                  render: (r) => formatDateTime(r.finish),
                  csvValue: (r) => toExcelDateTimeString(r.finish),
                },
                { key: "remark", label: "Remark (Milling)", render: (r) => r.remark },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-outline"
                        type="button"
                        style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                        onClick={() => loadIntoInput(r)}
                      >
                        Input Aftermix
                      </button>
                      <button
                        className="btn btn-outline"
                        type="button"
                        style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                        onClick={() =>
                          openScheduleModal({
                            order: r.order,
                            materialNumber: r.materialNumber,
                            materialDescription: r.materialDescription,
                            batch: r.batch,
                          })
                        }
                      >
                        📅 Jadwalkan
                      </button>
                    </div>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
            )}
          </div>
        </div>
      )}

      {tab === "queue" && section === "PREMIX" && (
        <div className="panel">
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO dari Master Data Cooispi yang Material Number-nya pernah punya histori Premix, dan Start Premix-nya
              belum diisi (termasuk yang baru Form Received) -- diurutkan sesuai urutan Master Data Cooispi. PWO
              otomatis hilang dari daftar ini begitu Start Premix-nya sudah diisi, atau begitu PWO itu sudah masuk
              tahap setelah Premix (Milling, Aftermix, Colour Matching, Approval, Packing). Material Number yang
              memang tidak pernah lewat Premix (bukan bagian rangkaian proses material itu) tidak ikut ditampilkan di
              sini.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input
                placeholder="Cari nomor Order..."
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                style={{ padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button type="button" className={`btn ${queueView === "list" ? "" : "btn-outline"}`} onClick={() => setQueueView("list")}>
                  📋 List
                </button>
                <button type="button" className={`btn ${queueView === "calendar" ? "" : "btn-outline"}`} onClick={() => setQueueView("calendar")}>
                  📅 Kalender
                </button>
              </div>
            </div>

            {queueView === "calendar" ? (
              <DndContext sensors={dragSensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Tarik Order dari daftar di bawah ini ke kolom hari yang diinginkan di Kalender untuk menjadwalkan --
                  kartu yang sudah terjadwal juga bisa ditarik ke hari lain utk pindah, atau pakai ▲▼ di kartunya utk
                  ubah urutan. Order yang sudah dijadwalkan otomatis hilang dari daftar di bawah ini. Tahan{" "}
                  <strong>Ctrl</strong> lalu klik beberapa Order (di daftar di bawah maupun kartu di Kalender) untuk
                  pilih banyak sekaligus, lalu tarik salah satunya -- semuanya ikut pindah bareng.
                </p>
                {selectedIds.size > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: "0.78rem" }}>
                    <span style={{ color: "var(--navy-dark)", fontWeight: 700 }}>{selectedIds.size} Order dipilih</span>
                    <button type="button" className="btn btn-outline" style={{ padding: "2px 10px" }} onClick={() => setSelectedIds(new Set())}>
                      Batal Pilih
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 2px 10px", marginBottom: 4 }}>
                  {filteredPremixQueue.filter((r) => !scheduledOrders.has(r.order)).map((r) => (
                    <DraggableQueueChip key={r.order} row={r} selected={selectedIds.has(buildQueueDragId(r.order))} onToggleSelect={toggleSelect} />
                  ))}
                  {filteredPremixQueue.filter((r) => !scheduledOrders.has(r.order)).length === 0 && (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Semua antrian sudah dijadwalkan (atau antrian kosong).</span>
                  )}
                </div>
                <WeeklyScheduleCalendar
                  events={pwoScheduleQuery.data ?? []}
                  onDelete={(id) => deleteScheduleMutation.mutate(id)}
                  onReorderDay={handleReorderDay}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                />
                <DragOverlay>
                  {activeDrag && (
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        background: "#fff",
                        boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
                        maxWidth: 200,
                      }}
                    >
                      {activeDrag.kind === "multi" ? (
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--navy-dark)" }}>{activeDrag.count} Order dipilih</div>
                      ) : (
                        <>
                          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--navy-dark)" }}>{activeDrag.order}</div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{activeDrag.materialDescription ?? activeDrag.batch ?? ""}</div>
                        </>
                      )}
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            ) : (
            <DataTable
              rowKey={(r: PremixQueueRow) => r.order}
              exportFileName="premix-pwo-schedule-queue"
              storageKey="premix-pwo-queue"
              rows={filteredPremixQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                {
                  key: "formReceived",
                  label: "Form Received",
                  render: (r) => (r.formReceived ? formatDateTime(r.formReceived) : "-"),
                  csvValue: (r) => (r.formReceived ? toExcelDateTimeString(r.formReceived) : ""),
                },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-outline"
                        type="button"
                        style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                        onClick={() => loadIntoInput(r)}
                      >
                        Input Premix
                      </button>
                      <button
                        className="btn btn-outline"
                        type="button"
                        style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                        onClick={() =>
                          openScheduleModal({
                            order: r.order,
                            materialNumber: r.materialNumber,
                            materialDescription: r.materialDescription,
                            batch: r.batch,
                          })
                        }
                      >
                        📅 Jadwalkan
                      </button>
                    </div>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
            )}
          </div>
        </div>
      )}

      {scheduleTarget && (
        <Modal title={`Jadwalkan — Order ${scheduleTarget.order}`} onClose={() => setScheduleTarget(null)} width={380}>
          <div className="field-grid">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Tanggal</label>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            </div>
          </div>
          <p style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Order otomatis masuk ke urutan paling bawah hari ini -- ubah urutan lewat tombol ▲▼ di kartu-nya di
            Kalender, atau tarik kartu ke hari lain kalau mau pindah tanggal.
          </p>
          {scheduleError && <p className="error-text">{scheduleError}</p>}
          <button
            className="btn"
            type="button"
            style={{ marginTop: 12 }}
            disabled={!scheduleDate || scheduleMutation.isPending}
            onClick={() => scheduleMutation.mutate()}
          >
            {scheduleMutation.isPending ? "Menyimpan..." : "Simpan Jadwal"}
          </button>
        </Modal>
      )}
    </div>
  );
}
