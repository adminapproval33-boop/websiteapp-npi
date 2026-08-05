import { MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

export interface ScheduleEvent {
  id: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  /** Tanggal saja (jam diabaikan, 2026-08-05 instruksi eksplisit user: "menu
   * jam tidak perlu, cukup list & nomor urutan" -- versi awal 2026-08-04
   * pakai scheduledStart/scheduledEnd bergrid jam, sudah disederhanakan). */
  scheduledDate: string;
  /** Urutan prioritas dalam hari yg sama, 0 = paling atas/duluan dikerjakan. */
  sequence: number;
  /** Live lookup dari Master Data > Referensi Order/PO (SAP-COOISPI), kolom
   * "Today-Atp" (2026-08-05, instruksi eksplisit user) -- BUKAN disimpan di
   * PwoSchedule sendiri, lihat komentar GET /pwo-schedule di
   * premixAftermix.routes.ts. */
  todayAtp: string | null;
}

const DAY_LABELS = ["SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];

/** Prefix ID drop target 1 kolom hari (2026-08-05) -- diexport supaya
 * pemanggil (PremixAftermixPage.tsx) bisa urai `over.id` dari
 * DndContext.onDragEnd tanpa duplikasi format string. */
const DAY_DROP_PREFIX = "day";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildDayDropId(date: Date): string {
  return `${DAY_DROP_PREFIX}:${dateKey(date)}`;
}

export function parseDayDropId(id: string): { dateKey: string } | null {
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== DAY_DROP_PREFIX) return null;
  return { dateKey: parts[1] };
}

/** Sama persis logika `dateKey()` internal di atas, tapi dari ISO string
 * (`ScheduleEvent.scheduledDate`) -- diexport supaya pemanggil bisa
 * mencocokkan 1 Order ada di hari mana tanpa duplikasi logika format. */
export function dateKeyFromIso(iso: string): string {
  return dateKey(new Date(iso));
}

/** Prefix ID kartu jadwal yg sudah ada (draggable, 2026-08-05) -- diexport
 * spy parent bisa cocokkan `active.id` balik ke ScheduleEvent aslinya di
 * onDragEnd. */
const EVENT_DRAG_PREFIX = "event";
export function buildEventDragId(eventId: string): string {
  return `${EVENT_DRAG_PREFIX}:${eventId}`;
}

/** Prefix ID drop target "sisipkan SEBELUM kartu ini" (2026-08-05, instruksi
 * eksplisit user: bisa masukkan Order di sela-sela antrian, bukan cuma
 * nambah di paling bawah) -- tiap kartu SEKALIGUS jadi draggable (pindah) &
 * droppable (target sisip) via 2 hook dnd-kit berbeda di 1 elemen yg sama. */
const INSERT_BEFORE_PREFIX = "insertBefore";
export function buildInsertBeforeId(eventId: string): string {
  return `${INSERT_BEFORE_PREFIX}:${eventId}`;
}
export function parseInsertBeforeId(id: string): string | null {
  return id.startsWith(`${INSERT_BEFORE_PREFIX}:`) ? id.slice(INSERT_BEFORE_PREFIX.length + 1) : null;
}

/** Palet warna kartu -- pastel, di-cycle by index (mis. urutan kemunculan
 * jadwal), niru gaya referensi Dribbble "Task Management Dashboard Schedule
 * Experience" yg dikirim user (2026-08-04). */
const CARD_COLORS = [
  { bg: "#ede9fe", border: "#a78bfa", text: "#5b21b6" }, // ungu
  { bg: "#ffedd5", border: "#fb923c", text: "#9a3412" }, // oranye
  { bg: "#dbeafe", border: "#60a5fa", text: "#1e40af" }, // biru
  { bg: "#dcfce7", border: "#4ade80", text: "#166534" }, // hijau
  { bg: "#fce7f3", border: "#f472b6", text: "#9d174d" }, // pink
];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDayNum(d: Date): string {
  return String(d.getDate());
}

function fmtRangeLabel(monday: Date): string {
  const saturday = addDays(monday, 5);
  const sameMonth = monday.getMonth() === saturday.getMonth();
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const startStr = monday.toLocaleDateString("id-ID", sameMonth ? { day: "numeric" } : opts);
  const endStr = saturday.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return `${startStr} - ${endStr}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Kartu 1 jadwal dalam list hari -- draggable (pindah hari) + tombol ▲▼
 * (ubah urutan dalam hari yg sama, 2026-08-05 instruksi eksplisit user:
 * "nomor urutan"). SENGAJA tombol ▲▼ dipilih drpd drag-reorder halus dalam 1
 * kolom -- lebih pasti/gampang dipakai drpd drag presisi pixel-demi-pixel,
 * dan drag antar-hari (via drop di kolom lain) tetap tersedia utk pindah
 * hari. */
function EventCard({
  ev,
  seqDisplay,
  color,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
  selected,
  onToggleSelect,
}: {
  ev: ScheduleEvent;
  seqDisplay: number;
  color: (typeof CARD_COLORS)[number];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete?: (id: string) => void;
  /** Kartu ini termasuk yg sedang dipilih (Ctrl+Klik, 2026-08-05 instruksi
   * eksplisit user: pilih banyak Order sekaligus lalu drag bareng). */
  selected: boolean;
  onToggleSelect: (dragId: string, e: ReactMouseEvent) => void;
}) {
  const dragId = buildEventDragId(ev.id);
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { type: "scheduled" as const, event: ev },
  });
  // Kartu ini SEKALIGUS drop target "sisipkan sebelum sini" (2026-08-05,
  // instruksi eksplisit user: bisa masukkan Order di sela-sela antrian) --
  // 2 hook dnd-kit (drag + drop) digabung di 1 elemen DOM yg sama lewat 2
  // ref callback terpisah (setDragRef dari useDraggable, setDropRef dari
  // useDroppable di bawah).
  const { setNodeRef: setDropRef, isOver: isInsertTarget } = useDroppable({ id: buildInsertBeforeId(ev.id) });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...listeners}
      {...attributes}
      onClick={(e) => onToggleSelect(dragId, e)}
      title={`${ev.order} — ${ev.materialDescription ?? ""} (tarik utk pindah hari, Ctrl+Klik utk pilih banyak sekaligus, lepas Order lain di sini utk sisip sebelum ini)`}
      style={{
        background: color.bg,
        borderLeft: `3px solid ${isInsertTarget ? "#4338ca" : color.border}`,
        borderTop: isInsertTarget ? "2px solid #4338ca" : "2px solid transparent",
        borderRadius: 6,
        padding: "6px 8px",
        marginBottom: 6,
        boxShadow: selected ? "0 0 0 2px #4338ca" : "0 1px 2px rgba(0,0,0,0.06)",
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 20 : "auto",
        transform: transform ? CSS.Translate.toString(transform) : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
        <span
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            color: color.text,
            background: "rgba(255,255,255,0.6)",
            borderRadius: 999,
            width: 18,
            height: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          {seqDisplay}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {ev.order}
          </div>
          <div style={{ fontSize: "0.66rem", color: color.text, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {ev.materialDescription ?? ev.batch ?? ""}
          </div>
          <div style={{ fontSize: "0.64rem", color: color.text, opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Today-ATP: {ev.todayAtp || "-"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: "0 0 auto" }}>
          <button
            type="button"
            title="Naikkan urutan"
            disabled={!canMoveUp}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMoveUp}
            style={{ border: "none", background: "none", cursor: canMoveUp ? "pointer" : "default", color: color.text, opacity: canMoveUp ? 1 : 0.3, fontSize: "0.65rem", lineHeight: 1, padding: 0 }}
          >
            ▲
          </button>
          <button
            type="button"
            title="Turunkan urutan"
            disabled={!canMoveDown}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMoveDown}
            style={{ border: "none", background: "none", cursor: canMoveDown ? "pointer" : "default", color: color.text, opacity: canMoveDown ? 1 : 0.3, fontSize: "0.65rem", lineHeight: 1, padding: 0 }}
          >
            ▼
          </button>
        </div>
        {onDelete && (
          <button
            type="button"
            title="Hapus jadwal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDelete(ev.id)}
            style={{ border: "none", background: "none", cursor: "pointer", color: color.text, fontSize: "0.7rem", lineHeight: 1, padding: 0, flex: "0 0 auto" }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** 1 kolom hari -- drop target (Queue chip ATAU kartu dari hari lain) +
 * daftar kartu terurut `sequence`. */
function DayColumn({
  date,
  events,
  onDelete,
  onReorder,
  selectedIds,
  onToggleSelect,
}: {
  date: Date;
  events: ScheduleEvent[];
  onDelete?: (id: string) => void;
  onReorder: (dayEvents: ScheduleEvent[]) => void;
  selectedIds: Set<string>;
  onToggleSelect: (dragId: string, e: ReactMouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: buildDayDropId(date) });
  const isToday = isSameDay(date, new Date());
  const sorted = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);

  function moveBy(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorder(next);
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1,
        minHeight: 160,
        padding: 8,
        background: isOver ? "#eef2ff" : isToday ? "#fafaff" : undefined,
        transition: "background 0.1s",
      }}
    >
      {sorted.map((ev, idx) => (
        <EventCard
          key={ev.id}
          ev={ev}
          seqDisplay={idx + 1}
          color={CARD_COLORS[idx % CARD_COLORS.length]}
          canMoveUp={idx > 0}
          canMoveDown={idx < sorted.length - 1}
          onMoveUp={() => moveBy(idx, -1)}
          onMoveDown={() => moveBy(idx, 1)}
          onDelete={onDelete}
          selected={selectedIds.has(buildEventDragId(ev.id))}
          onToggleSelect={onToggleSelect}
        />
      ))}
      {sorted.length === 0 && <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center", marginTop: 12 }}>-</div>}
    </div>
  );
}

/**
 * Kalender mingguan "PWO Schedule & Queue" (2026-08-04, instruksi eksplisit
 * user, niru referensi Dribbble "Task Management Dashboard Schedule
 * Experience" -- DISEDERHANAKAN 2026-08-05, instruksi eksplisit user: "menu
 * jam tidak perlu, cukup list & nomor urutan"). Tiap hari (Senin-Sabtu, pola
 * kerja pabrik lokal) sekarang cuma daftar kartu bernomor urut, BUKAN grid
 * jam lagi.
 *
 * Penjadwalan: drag Order dari strip "Queue" (dirender pemanggil, lihat
 * PremixAftermixPage.tsx) lalu lepas ke kolom hari yg diinginkan -- otomatis
 * masuk ke urutan PALING BAWAH hari itu. Kartu yg sudah ada juga bisa ditarik
 * ke kolom hari lain utk pindah hari. Urutan DALAM 1 hari diubah lewat tombol
 * ▲▼ di tiap kartu (bukan drag-reorder halus -- lebih pasti dipakai).
 * Komponen ini SENDIRI tidak menaruh state/logika drag (cuma jadi drop
 * target `useDroppable` per kolom + drag source `useDraggable` per kartu) --
 * `DndContext`/`onDragEnd` ada di pemanggil, supaya strip Queue & kalender
 * ini bisa jadi 1 zona drag-drop yg sama.
 */
export default function WeeklyScheduleCalendar({
  events,
  onDelete,
  onReorderDay,
  selectedIds,
  onToggleSelect,
}: {
  events: ScheduleEvent[];
  onDelete?: (id: string) => void;
  /** Dipanggil dgn urutan kartu BARU utk 1 hari (hasil klik ▲▼) -- pemanggil
   * yg bertanggung jawab kirim ke PUT /pwo-schedule/reorder. */
  onReorderDay: (dayEvents: ScheduleEvent[]) => void;
  /** Kartu (drag-id) mana saja yg sedang dipilih via Ctrl+Klik (2026-08-05,
   * instruksi eksplisit user: pilih beberapa Order sekaligus lalu drag
   * bareng) -- state-nya dipegang pemanggil (PremixAftermixPage.tsx) supaya
   * seleksi bisa lintas strip Queue & kalender ini sekaligus. */
  selectedIds: Set<string>;
  onToggleSelect: (dragId: string, e: ReactMouseEvent) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();

  const eventsByDay = useMemo(() => {
    const map = new Map<number, ScheduleEvent[]>();
    days.forEach((_, i) => map.set(i, []));
    events.forEach((ev) => {
      const d = new Date(ev.scheduledDate);
      const dayIdx = days.findIndex((x) => isSameDay(x, d));
      if (dayIdx >= 0) map.get(dayIdx)!.push(ev);
    });
    return map;
  }, [events, days]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--toolbar-bg)" }}>
        <div style={{ fontWeight: 700, color: "var(--text-main)" }}>{fmtRangeLabel(weekStart)}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-outline" style={{ padding: "4px 10px" }} onClick={() => setWeekStart((w) => addDays(w, -7))}>
            ← Minggu Lalu
          </button>
          <button type="button" className="btn btn-outline" style={{ padding: "4px 10px" }} onClick={() => setWeekStart(getMonday(new Date()))}>
            Minggu Ini
          </button>
          <button type="button" className="btn btn-outline" style={{ padding: "4px 10px" }} onClick={() => setWeekStart((w) => addDays(w, 7))}>
            Minggu Depan →
          </button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 900, display: "grid", gridTemplateColumns: "repeat(6, minmax(150px, 1fr))" }}>
          {days.map((d, i) => {
            const isToday = isSameDay(d, today);
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", borderRight: i < 5 ? "1px solid var(--border)" : undefined }}>
                <div
                  style={{
                    borderBottom: "1px solid var(--border)",
                    padding: "8px 10px",
                    textAlign: "center",
                    background: isToday ? "var(--panel-header)" : undefined,
                  }}
                >
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.5 }}>{DAY_LABELS[i]}</div>
                  <div style={{ fontSize: "1rem", fontWeight: 700, color: isToday ? "var(--navy)" : "var(--text-main)" }}>{fmtDayNum(d)}</div>
                </div>
                <DayColumn
                  date={d}
                  events={eventsByDay.get(i) ?? []}
                  onDelete={onDelete}
                  onReorder={onReorderDay}
                  selectedIds={selectedIds}
                  onToggleSelect={onToggleSelect}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
