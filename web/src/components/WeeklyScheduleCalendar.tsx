import { Fragment, useEffect, useMemo, useRef, useState } from "react";

export interface ScheduleEvent {
  id: string;
  order: string;
  materialDescription: string | null;
  batch: string | null;
  scheduledStart: string;
  scheduledEnd: string;
}

const DAY_LABELS = ["SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];
const HOUR_START = 6;
const HOUR_END = 20;
const HOUR_HEIGHT = 56;
/** Tinggi maksimum area jam sebelum di-scroll internal -- tanpa ini grid
 * 06:00-20:00 (14 baris, ~784px) merender inline di alur halaman biasa,
 * sehingga jam-jam yg umum dipakai (mis. jadwal jam 08:00) terdorong jauh
 * di bawah layar dan terlihat seperti "tidak ada data" (bug dilaporkan
 * user 2026-08-04: "kalender tidak terlihat no Ordernya" -- ternyata cuma
 * perlu scroll panjang, bukan bug data). */
const BODY_MAX_HEIGHT = HOUR_HEIGHT * 6;

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

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Kalender mingguan (2026-08-04, instruksi eksplisit user, niru referensi
 * Dribbble "Task Management Dashboard Schedule Experience") -- tampilan
 * TAMBAHAN di samping tabel PWO Schedule & Queue yang sudah ada (toggle
 * List/Kalender, bukan pengganti). Penjadwalan dilakukan lewat klik tombol
 * "Jadwalkan" di tabel (buka form pilih tanggal & jam) -- SENGAJA bukan
 * drag-drop, sesuai pilihan eksplisit user (drag-drop custom grid lebih
 * rawan bug lintas browser & lebih lama dikerjakan). Grid jam 06:00-20:00,
 * Senin-Sabtu (6 hari, bukan 7 -- pola kerja pabrik lokal). */
export default function WeeklyScheduleCalendar({
  events,
  onDelete,
}: {
  events: ScheduleEvent[];
  onDelete?: (id: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const bodyRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = useMemo(() => Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i), []);
  const today = new Date();

  useEffect(() => {
    if (!bodyRef.current) return;
    const now = new Date();
    const showingCurrentWeek = days.some((d) => isSameDay(d, now));
    const anchorHour = showingCurrentWeek ? now.getHours() : HOUR_START;
    const offset = Math.max(0, anchorHour - HOUR_START - 1) * HOUR_HEIGHT;
    bodyRef.current.scrollTop = offset;
  }, [weekStart]);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, ScheduleEvent[]>();
    days.forEach((_, i) => map.set(i, []));
    events.forEach((ev) => {
      const start = new Date(ev.scheduledStart);
      const dayIdx = days.findIndex((d) => isSameDay(d, start));
      if (dayIdx >= 0) map.get(dayIdx)!.push(ev);
    });
    return map;
  }, [events, days]);

  function eventStyle(ev: ScheduleEvent, colorIdx: number) {
    const start = new Date(ev.scheduledStart);
    const end = new Date(ev.scheduledEnd);
    const startOffset = start.getHours() + start.getMinutes() / 60 - HOUR_START;
    const endOffset = end.getHours() + end.getMinutes() / 60 - HOUR_START;
    const top = Math.max(0, startOffset) * HOUR_HEIGHT;
    const height = Math.max(0.5, endOffset - startOffset) * HOUR_HEIGHT;
    const color = CARD_COLORS[colorIdx % CARD_COLORS.length];
    return { top, height, color };
  }

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
        <div style={{ minWidth: 960 }}>
          {/* Header baris hari -- di luar area scroll vertikal supaya tetap terlihat */}
          <div style={{ display: "grid", gridTemplateColumns: "56px repeat(6, minmax(150px, 1fr))" }}>
            <div style={{ borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)" }} />
            {days.map((d, i) => {
              const isToday = isSameDay(d, today);
              return (
                <div
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    borderRight: i < 5 ? "1px solid var(--border)" : undefined,
                    padding: "8px 10px",
                    textAlign: "center",
                    background: isToday ? "var(--panel-header)" : undefined,
                  }}
                >
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.5 }}>{DAY_LABELS[i]}</div>
                  <div style={{ fontSize: "1rem", fontWeight: 700, color: isToday ? "var(--navy)" : "var(--text-main)" }}>{fmtDayNum(d)}</div>
                </div>
              );
            })}
          </div>

          {/* Grid jam x hari -- scroll vertikal internal, lihat catatan BODY_MAX_HEIGHT */}
          <div ref={bodyRef} style={{ maxHeight: BODY_MAX_HEIGHT, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px repeat(6, minmax(150px, 1fr))" }}>
          {hours.map((h) => (
            <Fragment key={`row-${h}`}>
              <div
                key={`h-${h}`}
                style={{
                  borderRight: "1px solid var(--border)",
                  borderTop: "1px solid #f1f5f9",
                  height: HOUR_HEIGHT,
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  textAlign: "right",
                  paddingRight: 6,
                  paddingTop: 2,
                }}
              >
                {fmtHour(h)}
              </div>
              {days.map((d, dayIdx) => (
                <div
                  key={`cell-${h}-${dayIdx}`}
                  style={{
                    position: "relative",
                    borderRight: dayIdx < 5 ? "1px solid var(--border)" : undefined,
                    borderTop: "1px solid #f1f5f9",
                    height: HOUR_HEIGHT,
                    background: isSameDay(d, today) ? "#fafaff" : undefined,
                  }}
                >
                  {h === HOUR_START &&
                    (eventsByDay.get(dayIdx) ?? []).map((ev, idx) => {
                      const { top, height, color } = eventStyle(ev, idx);
                      return (
                        <div
                          key={ev.id}
                          title={`${ev.order} — ${ev.materialDescription ?? ""}`}
                          style={{
                            position: "absolute",
                            top,
                            left: 3,
                            right: 3,
                            height,
                            minHeight: 32,
                            background: color.bg,
                            borderLeft: `3px solid ${color.border}`,
                            borderRadius: 6,
                            padding: "4px 6px",
                            overflow: "hidden",
                            zIndex: 1,
                            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: color.text }}>
                              {new Date(ev.scheduledStart).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                              {" – "}
                              {new Date(ev.scheduledEnd).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {onDelete && (
                              <button
                                type="button"
                                title="Hapus jadwal"
                                onClick={() => onDelete(ev.id)}
                                style={{ border: "none", background: "none", cursor: "pointer", color: color.text, fontSize: "0.7rem", lineHeight: 1, padding: 0 }}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {ev.order}
                          </div>
                          <div style={{ fontSize: "0.66rem", color: color.text, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {ev.materialDescription ?? ev.batch ?? ""}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}
            </Fragment>
          ))}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
