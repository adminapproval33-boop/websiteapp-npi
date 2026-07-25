export type SpecVerdict = "pass" | "fail" | "unknown";

/**
 * Evaluasi hasil cek terhadap string spesifikasi, mis. "40-45" (rentang),
 * "<=28", ">=10", "<5", ">5", atau angka tunggal (exact match).
 * Duplikat sengaja dari web/src/lib/specEval.ts -- server & web adalah
 * proyek TS terpisah tanpa package bersama, jaga tetap sinkron manual
 * kalau logika di salah satu sisi berubah.
 */
export function evaluateSpec(spec: string | null | undefined, result: string | null | undefined): SpecVerdict {
  const specTrim = String(spec ?? "").trim();
  const resultNum = parseFloat(String(result ?? "").trim());
  if (!specTrim || Number.isNaN(resultNum)) return "unknown";

  const num = "(-?\\d+(?:\\.\\d+)?)";
  let m: RegExpMatchArray | null;

  if ((m = specTrim.match(new RegExp(`^${num}\\s*-\\s*${num}$`)))) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    return resultNum >= Math.min(lo, hi) && resultNum <= Math.max(lo, hi) ? "pass" : "fail";
  }
  if ((m = specTrim.match(new RegExp(`^<=\\s*${num}$`)))) return resultNum <= parseFloat(m[1]) ? "pass" : "fail";
  if ((m = specTrim.match(new RegExp(`^>=\\s*${num}$`)))) return resultNum >= parseFloat(m[1]) ? "pass" : "fail";
  if ((m = specTrim.match(new RegExp(`^<\\s*${num}$`)))) return resultNum < parseFloat(m[1]) ? "pass" : "fail";
  if ((m = specTrim.match(new RegExp(`^>\\s*${num}$`)))) return resultNum > parseFloat(m[1]) ? "pass" : "fail";
  if ((m = specTrim.match(new RegExp(`^=?\\s*${num}$`)))) return resultNum === parseFloat(m[1]) ? "pass" : "fail";

  return "unknown";
}
