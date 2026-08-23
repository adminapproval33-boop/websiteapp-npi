/** Qty di semua modul disimpan sbg free-text String (diketik manual di lantai
 * produksi, tanpa validasi format), jadi tidak bisa pakai Prisma `_sum`
 * (butuh kolom numerik). Parse manual: buang semua karakter selain
 * digit/titik/minus, lalu `parseFloat`; string kosong/non-numerik -> 0.
 * Dipindah dari dashboard.routes.ts (2026-08-23) ke sini supaya bisa dipakai
 * bareng stageGate.ts (agregasi Qty Act tanki turunan Milling) tanpa duplikasi. */
export function parseQtyNumber(v: string | null | undefined): number {
  if (!v) return 0;
  const cleaned = v.replace(/[^\d.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
