import { KeyboardEvent } from "react";

/** Tipe input yang SUDAH punya arti sendiri untuk panah (native browser
 * behavior) -- date/datetime-local/time/month/week pakai panah utk geser
 * segmen tanggal/jam, number pakai panah utk naik/turun nilai, select pakai
 * panah utk ganti opsi terpilih. Navigasi grid ala Excel di bawah ini SENGAJA
 * tidak ikut campur di tipe-tipe ini -- kalau dipaksa, malah menghilangkan
 * fungsi normalnya. */
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const NATIVE_ARROW_INPUT_TYPES = new Set(["date", "datetime-local", "time", "month", "week", "number"]);

function usesNativeArrowBehavior(target: EventTarget | null): boolean {
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return NATIVE_ARROW_INPUT_TYPES.has(target.type);
  return false;
}

/** True kalau caret sudah di ujung teks (awal utk Left, akhir utk Right) DAN
 * tidak ada teks yang lagi diseleksi -- baru boleh lompat sel, supaya panah
 * kiri/kanan tetap bisa dipakai edit teks di dalam field seperti biasa. */
function isCaretAtEdge(target: EventTarget | null, edge: "start" | "end"): boolean {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return true;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  if (start === null || end === null || start !== end) return false;
  return edge === "start" ? start === 0 : end === target.value.length;
}

function focusCell(scope: Element, navKey: string): boolean {
  const cell = scope.querySelector(`[data-navkey="${navKey}"]`);
  if (!cell) return false;
  const focusable = cell.querySelector<HTMLElement>("input, select, textarea, button");
  if (!focusable) return false;
  focusable.focus();
  if ((focusable instanceof HTMLInputElement || focusable instanceof HTMLTextAreaElement) && !usesNativeArrowBehavior(focusable)) {
    focusable.select();
  }
  return true;
}

/**
 * Navigasi panah ala Excel antar sel (ExcelField MAUPUN <td> tabel dinamis
 * spt Spec Parameters, lihat CheckResultsPage.tsx/AdminQcPage.tsx) dalam 1
 * "nav scope" (elemen ber-`data-nav-scope`, lihat ExcelBlock di ExcelGrid.tsx
 * -- supaya kalau ada 2 form/tabel di 1 halaman yg kebetulan pakai nama key
 * sama, navigasi tidak salah lompat ke scope lain), memakai struktur kolom
 * `*_COL_ROWS` yang SAMA dengan yang sudah dipakai fitur resize-kolom (lihat
 * useResizableColWidths) -- supaya urutan visual & urutan navigasi panah
 * selalu konsisten satu sama lain tanpa perlu didata dua kali (2026-08-10,
 * instruksi eksplisit user, diterapkan ke semua halaman modul yang pakai
 * ExcelGrid, lalu diperluas ke tabel dinamis Spec Parameters).
 *
 * Kanan/Kiri: pindah antar kolom dalam baris yang sama (lompat ke baris
 * berikut/sebelumnya kalau sudah di ujung), TAPI hanya kalau caret memang
 * sudah di ujung teks -- supaya tetap bisa dipakai edit teks normal.
 * Atas/Bawah: pindah ke field yang posisi kolomnya paling dekat di baris
 * atas/bawah (baris bisa beda jumlah kolom -- posisi kolom di-clamp).
 */
export function handleExcelGridKeyNav(e: KeyboardEvent<HTMLElement>, colRows: string[][]) {
  if (!ARROW_KEYS.has(e.key) || usesNativeArrowBehavior(e.target)) return;

  const navKey = e.currentTarget.dataset.navkey;
  if (!navKey) return;

  let rowIdx = -1;
  let colIdx = -1;
  for (let r = 0; r < colRows.length; r++) {
    const c = colRows[r].indexOf(navKey);
    if (c !== -1) {
      rowIdx = r;
      colIdx = c;
      break;
    }
  }
  if (rowIdx === -1) return;

  let targetKey: string | undefined;
  if (e.key === "ArrowRight" && isCaretAtEdge(e.target, "end")) {
    targetKey = colIdx < colRows[rowIdx].length - 1 ? colRows[rowIdx][colIdx + 1] : colRows[rowIdx + 1]?.[0];
  } else if (e.key === "ArrowLeft" && isCaretAtEdge(e.target, "start")) {
    targetKey = colIdx > 0 ? colRows[rowIdx][colIdx - 1] : colRows[rowIdx - 1]?.at(-1);
  } else if (e.key === "ArrowDown") {
    const nextRow = colRows[rowIdx + 1];
    targetKey = nextRow?.[Math.min(colIdx, nextRow.length - 1)];
  } else if (e.key === "ArrowUp") {
    const prevRow = colRows[rowIdx - 1];
    targetKey = prevRow?.[Math.min(colIdx, prevRow.length - 1)];
  }
  if (!targetKey) return;

  const scope = e.currentTarget.closest("[data-nav-scope]");
  if (scope && focusCell(scope, targetKey)) {
    e.preventDefault();
  }
}
