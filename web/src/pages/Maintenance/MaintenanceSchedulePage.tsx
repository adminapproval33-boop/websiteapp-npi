import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api/client";
import { MAINTENANCE_STATUS_COLOR, MaintenanceRow } from "./types";

const DAY_LABELS = ["SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtRangeLabel(monday: Date): string {
  const saturday = addDays(monday, 5);
  const sameMonth = monday.getMonth() === saturday.getMonth();
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const startStr = monday.toLocaleDateString("id-ID", sameMonth ? { day: "numeric" } : opts);
  const endStr = saturday.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return `${startStr} - ${endStr}`;
}

const DAY_DROP_PREFIX = "day";
const QUEUE_DRAG_PREFIX = "queue";
const CARD_DRAG_PREFIX = "card";

function PriorityDot({ priority }: { priority: string | null }) {
  if (priority !== "Urgent") return null;
  return <span style={{ color: "var(--danger)", fontWeight: 700, fontSize: "0.65rem" }}>● URGENT</span>;
}

/** Chip 1 Job di strip "Belum Dijadwalkan" -- draggable ke kolom hari manapun. */
function QueueChip({ row }: { row: MaintenanceRow }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${QUEUE_DRAG_PREFIX}:${row.id}`,
    data: { row },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${row.codeTanki} -- ${row.description} (tarik ke kolom hari utk menjadwalkan)`}
      style={{
        background: "#fff7ed",
        border: "1px solid #fb923c",
        borderRadius: 6,
        padding: "6px 10px",
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.4 : 1,
        minWidth: 160,
        transform: transform ? CSS.Translate.toString(transform) : undefined,
      }}
    >
      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#9a3412" }}>{row.codeTanki}</div>
      <div style={{ fontSize: "0.68rem", color: "#9a3412", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
        {row.description}
      </div>
      <PriorityDot priority={row.priority} />
    </div>
  );
}

/** Kartu 1 Job yg sudah terjadwal dalam 1 kolom hari -- draggable (pindah
 * hari) + tombol ▲▼ (ubah urutan dalam hari yg sama). */
function ScheduledCard({
  row,
  seqDisplay,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  row: MaintenanceRow;
  seqDisplay: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${CARD_DRAG_PREFIX}:${row.id}`,
    data: { row },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${row.codeTanki} -- ${row.description} (tarik utk pindah hari)`}
      style={{
        background: "#ede9fe",
        borderLeft: "3px solid #a78bfa",
        borderRadius: 6,
        padding: "6px 8px",
        marginBottom: 6,
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.4 : 1,
        transform: transform ? CSS.Translate.toString(transform) : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
        <span
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            color: "#5b21b6",
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
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5b21b6" }}>{row.codeTanki}</div>
          <div style={{ fontSize: "0.66rem", color: "#5b21b6", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.description}
          </div>
          <div style={{ fontSize: "0.64rem", color: MAINTENANCE_STATUS_COLOR[row.status], fontWeight: 700 }}>{row.status}</div>
          <PriorityDot priority={row.priority} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: "0 0 auto" }}>
          <button
            type="button"
            title="Naikkan urutan"
            disabled={!canMoveUp}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMoveUp}
            style={{ border: "none", background: "none", cursor: canMoveUp ? "pointer" : "default", color: "#5b21b6", opacity: canMoveUp ? 1 : 0.3, fontSize: "0.65rem", lineHeight: 1, padding: 0 }}
          >
            ▲
          </button>
          <button
            type="button"
            title="Turunkan urutan"
            disabled={!canMoveDown}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMoveDown}
            style={{ border: "none", background: "none", cursor: canMoveDown ? "pointer" : "default", color: "#5b21b6", opacity: canMoveDown ? 1 : 0.3, fontSize: "0.65rem", lineHeight: 1, padding: 0 }}
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  );
}

function DayColumn({ date, rows, onReorder }: { date: Date; rows: MaintenanceRow[]; onReorder: (dateKeyStr: string, ordered: MaintenanceRow[]) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_DROP_PREFIX}:${dateKey(date)}` });
  const isToday = isSameDay(date, new Date());
  const sorted = useMemo(() => [...rows].sort((a, b) => a.sequence - b.sequence), [rows]);

  function moveBy(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorder(dateKey(date), next);
  }

  return (
    <div key={dateKey(date)} style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
      <div style={{ borderBottom: "1px solid var(--border)", padding: "8px 10px", textAlign: "center", background: isToday ? "var(--panel-header)" : undefined }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.5 }}>{DAY_LABELS[date.getDay() === 0 ? 6 : date.getDay() - 1]}</div>
        <div style={{ fontSize: "1rem", fontWeight: 700, color: isToday ? "var(--navy)" : "var(--text-main)" }}>{date.getDate()}</div>
      </div>
      <div ref={setNodeRef} style={{ flex: 1, minHeight: 160, padding: 8, background: isOver ? "#eef2ff" : isToday ? "#fafaff" : undefined, transition: "background 0.1s" }}>
        {sorted.map((row, idx) => (
          <ScheduledCard
            key={row.id}
            row={row}
            seqDisplay={idx + 1}
            canMoveUp={idx > 0}
            canMoveDown={idx < sorted.length - 1}
            onMoveUp={() => moveBy(idx, -1)}
            onMoveDown={() => moveBy(idx, 1)}
          />
        ))}
        {sorted.length === 0 && <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center", marginTop: 12 }}>-</div>}
      </div>
    </div>
  );
}

/**
 * "Jadwal Pengerjaan" (2026-08-06, instruksi eksplisit user) -- kalender
 * drag-drop day+sequence, pola SAMA SEMANGAT dgn "PWO Schedule & Queue"
 * (WeeklyScheduleCalendar.tsx), tapi versi DISEDERHANAKAN khusus Maintenance
 * (kartu ditulis ulang di sini, BUKAN reuse WeeklyScheduleCalendar --
 * komponen itu label-nya hardcode "Today-ATP" utk konteks Order/Material,
 * tidak cocok ditampilkan apa adanya utk Job Maintenance) -- TANPA
 * multi-select Ctrl+Klik & sisip-presisi-antar-kartu (drop di kolom hari
 * SELALU taruh di paling bawah; urutan presisi diatur lewat tombol ▲▼ per
 * kartu). Job yg belum py Jadwal Pengerjaan (scheduledDate null) muncul di
 * strip "Belum Dijadwalkan" -- tarik ke kolom hari manapun utk menjadwalkan.
 * Job yg sudah "Selesai" (finish terisi) TIDAK muncul lagi di sini sama
 * sekali (lihat GET /maintenance/schedule, where finish:null) -- kalender
 * ini murni utk kerjaan yg masih perlu dijadwalkan/dikerjakan.
 */
export default function MaintenanceSchedulePage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [activeRow, setActiveRow] = useState<MaintenanceRow | null>(null);

  const scheduleQuery = useQuery({
    queryKey: ["maintenance-schedule"],
    queryFn: () => api.get<{ success: boolean; data: MaintenanceRow[] }>("/maintenance/schedule").then((r) => r.data),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ id, scheduledDate }: { id: number; scheduledDate: string }) => api.put(`/maintenance/${id}/schedule`, { scheduledDate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-schedule"] }),
  });

  const reorderMutation = useMutation({
    mutationFn: (payload: { scheduledDate: string; orderedIds: number[] }) => api.put("/maintenance/reorder", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-schedule"] }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const rows = scheduleQuery.data ?? [];
  const queueRows = rows.filter((r) => !r.scheduledDate);
  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const rowsByDay = useMemo(() => {
    const map = new Map<string, MaintenanceRow[]>();
    for (const r of rows) {
      if (!r.scheduledDate) continue;
      const key = dateKey(new Date(r.scheduledDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [rows]);

  function handleDragStart(evt: DragStartEvent) {
    const data = evt.active.data.current as { row: MaintenanceRow } | undefined;
    setActiveRow(data?.row ?? null);
  }

  function handleDragEnd(evt: DragEndEvent) {
    setActiveRow(null);
    const { active, over } = evt;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith(`${DAY_DROP_PREFIX}:`)) return;
    const targetDateKey = overId.slice(DAY_DROP_PREFIX.length + 1);
    const data = active.data.current as { row: MaintenanceRow } | undefined;
    if (!data) return;
    scheduleMutation.mutate({ id: data.row.id, scheduledDate: targetDateKey });
  }

  function handleReorder(dateKeyStr: string, ordered: MaintenanceRow[]) {
    reorderMutation.mutate({ scheduledDate: dateKeyStr, orderedIds: ordered.map((r) => r.id) });
  }

  return (
    <div className="panel">
      <div className="panel-header">Jadwal Pengerjaan</div>
      <div className="panel-body">
        <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Tarik Job dari strip "Belum Dijadwalkan" ke kolom hari utk menjadwalkan (otomatis masuk paling bawah hari
          itu). Kartu yg sudah terjadwal bisa ditarik ke hari lain utk pindah, atau pakai tombol ▲▼ utk mengubah
          urutan dalam hari yg sama. Job yg sudah "Selesai" tidak lagi muncul di sini.
        </p>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>Belum Dijadwalkan</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 50, padding: 8, border: "1px dashed var(--border)", borderRadius: 6 }}>
              {queueRows.map((r) => (
                <QueueChip key={r.id} row={r} />
              ))}
              {queueRows.length === 0 && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Semua Job sudah dijadwalkan.</span>}
            </div>
          </div>

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
                {days.map((d) => (
                  <DayColumn key={dateKey(d)} date={d} rows={rowsByDay.get(dateKey(d)) ?? []} onReorder={handleReorder} />
                ))}
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeRow && (
              <div style={{ background: "#ede9fe", borderLeft: "3px solid #a78bfa", borderRadius: 6, padding: "6px 8px", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5b21b6" }}>{activeRow.codeTanki}</div>
                <div style={{ fontSize: "0.66rem", color: "#5b21b6", opacity: 0.85 }}>{activeRow.description}</div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
