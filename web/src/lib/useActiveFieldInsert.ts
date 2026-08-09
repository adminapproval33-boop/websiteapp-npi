import { useRef } from "react";

type FieldTarget = { el: HTMLInputElement | HTMLTextAreaElement; setValue: (v: string) => void };

/**
 * Sisipkan simbol (°, µ, Ω, dst -- lihat SymbolPicker.tsx) ke field teks
 * yang TERAKHIR difokus di halaman ini (2026-08-09, instruksi eksplisit
 * user: butuh simbol QC spt Derajat yang tidak ada di keyboard biasa).
 * Field manapun bisa jadi target -- cukup daftarkan lewat `onFocus` yg
 * memanggil `registerFocus(event.currentTarget, setter)`, lalu 1 tombol
 * SymbolPicker di mana saja pada halaman bisa menyisipkan ke situ.
 */
export function useActiveFieldInsert() {
  const targetRef = useRef<FieldTarget | null>(null);

  function registerFocus(el: HTMLInputElement | HTMLTextAreaElement | null, setValue: (v: string) => void) {
    if (el) targetRef.current = { el, setValue };
  }

  function insert(symbol: string) {
    const target = targetRef.current;
    if (!target) return;
    const { el, setValue } = target;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + symbol + el.value.slice(end);
    setValue(next);
    // Kursor & value asli elemen DOM belum ikut ke-update sinkron (React
    // masih akan re-render dari state) -- tunda restore posisi kursor ke
    // frame berikutnya supaya tidak ketimpa balik oleh value lama.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + symbol.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return { registerFocus, insert };
}
