import { MouseEvent as ReactMouseEvent, useEffect, useState } from "react";

const SNAP_THRESHOLD_PX = 8;

/** Lebar kolom yang bisa di-drag bebas oleh user, persist ke localStorage per tabel/form
 * (key-nya bebas per field, dicocokkan lewat `defaults`). Dipakai bareng ExcelField
 * `widthPx` + `onResizeStart`, atau header tabel custom lain yang butuh drag-resize serupa.
 *
 * `rows` (opsional): urutan key kolom per baris visual (mis. `[["order","materialNumber",...],
 * ["iuPlant","codeTanki",...]]`) -- kalau diisi, saat drag akan "nempel" (magnet) ke tepi/titik-
 * tengah kolom di baris LAIN yang jaraknya dekat, mirip smart guide di Canva/Figma, dan
 * `guideX` (posisi garis bantu, relatif ke kiri ExcelBlock) dikembalikan supaya bisa dirender
 * sbg garis vertikal oleh halaman pemanggil. Tanpa `rows`, perilaku persis seperti sebelumnya. */
export function useResizableColWidths(defaults: Record<string, number>, storageKey: string, rows?: string[][]) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...defaults, ...(JSON.parse(raw) as Record<string, number>) } : { ...defaults };
    } catch {
      return { ...defaults };
    }
  });
  const [guideX, setGuideX] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [widths, storageKey]);

  /** Kandidat posisi "magnet": tepi kiri, tepi kanan, & titik tengah tiap kolom
   * di baris-baris LAIN (bukan baris kolom yg sedang di-drag). */
  function collectSnapCandidates(ownRowIdx: number): number[] {
    if (!rows) return [];
    const candidates = new Set<number>();
    rows.forEach((rowKeys, idx) => {
      if (idx === ownRowIdx) return;
      let x = 0;
      for (const key of rowKeys) {
        const w = widths[key] ?? defaults[key] ?? 0;
        candidates.add(x);
        candidates.add(x + w / 2);
        x += w;
        candidates.add(x);
      }
    });
    return Array.from(candidates);
  }

  function beginResize(colKey: string) {
    return (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widths[colKey] ?? defaults[colKey];

      const ownRowIdx = rows?.findIndex((r) => r.includes(colKey)) ?? -1;
      let leftEdge = 0;
      if (rows && ownRowIdx >= 0) {
        for (const key of rows[ownRowIdx]) {
          if (key === colKey) break;
          leftEdge += widths[key] ?? defaults[key] ?? 0;
        }
      }
      const snapCandidates = ownRowIdx >= 0 ? collectSnapCandidates(ownRowIdx) : [];

      function onMove(ev: MouseEvent) {
        let next = Math.max(40, startWidth + (ev.clientX - startX));
        let guide: number | null = null;

        if (snapCandidates.length > 0) {
          const rightEdge = leftEdge + next;
          const center = leftEdge + next / 2;
          let best: { dist: number; guide: number; width: number } | null = null;
          for (const c of snapCandidates) {
            const distRight = Math.abs(rightEdge - c);
            if (distRight <= SNAP_THRESHOLD_PX && (!best || distRight < best.dist)) {
              best = { dist: distRight, guide: c, width: Math.max(40, c - leftEdge) };
            }
            const distCenter = Math.abs(center - c);
            if (distCenter <= SNAP_THRESHOLD_PX && (!best || distCenter < best.dist)) {
              best = { dist: distCenter, guide: c, width: Math.max(40, (c - leftEdge) * 2) };
            }
          }
          if (best) {
            next = best.width;
            guide = best.guide;
          }
        }

        setGuideX(guide);
        setWidths((w) => ({ ...w, [colKey]: next }));
      }
      function onUp() {
        setGuideX(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  /** Hapus override milik user ini (localStorage-nya sendiri, tidak menyentuh user lain)
   * & kembalikan lebar semua kolom ke `defaults` bawaan aplikasi. */
  function reset() {
    localStorage.removeItem(storageKey);
    setWidths({ ...defaults });
  }

  return { widths, beginResize, guideX, reset };
}
