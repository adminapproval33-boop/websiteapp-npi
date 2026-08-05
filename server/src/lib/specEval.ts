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
  const resultTrim = String(result ?? "").trim();
  if (!specTrim) return "unknown";

  // Spec tekstual "OK" -- Result dibandingkan sbg teks "OK"/"NG" langsung
  // (2026-08-05, instruksi eksplisit user). Duplikat sengaja dari
  // web/src/lib/specEval.ts, jaga tetap sinkron.
  if (specTrim.toUpperCase() === "OK") {
    const resultUpper = resultTrim.toUpperCase();
    if (resultUpper === "OK") return "pass";
    if (resultUpper === "NG") return "fail";
    return "unknown";
  }

  const resultNum = parseFloat(resultTrim);
  if (Number.isNaN(resultNum)) return "unknown";

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

export type DetailedSpecVerdict = "ok" | "ok-lower" | "ok-center" | "ok-upper" | "ng" | "unknown";

/**
 * Versi detail evaluateSpec di atas -- utk spec RENTANG, OK dipecah jadi
 * Lower/Center/Upper (sepertiga rentang) drpd digabung "pass" polos. Dipakai
 * Dashboard > Quality Check Review (2026-08-05, instruksi eksplisit user:
 * breakdown jumlah OK/OK Lower/OK Center/OK Upper/NG). Duplikat sengaja dari
 * web/src/lib/specEval.ts (SpecVerdict), jaga tetap sinkron.
 */
export function evaluateSpecDetailed(spec: string | null | undefined, result: string | null | undefined): DetailedSpecVerdict {
  const specTrim = String(spec ?? "").trim();
  const resultTrim = String(result ?? "").trim();
  if (!specTrim) return "unknown";

  if (specTrim.toUpperCase() === "OK") {
    const resultUpper = resultTrim.toUpperCase();
    if (resultUpper === "OK") return "ok";
    if (resultUpper === "NG") return "ng";
    return "unknown";
  }

  const resultNum = parseFloat(resultTrim);
  if (Number.isNaN(resultNum)) return "unknown";

  const num = "(-?\\d+(?:\\.\\d+)?)";
  let m: RegExpMatchArray | null;

  if ((m = specTrim.match(new RegExp(`^${num}\\s*-\\s*${num}$`)))) {
    const lo = Math.min(parseFloat(m[1]), parseFloat(m[2]));
    const hi = Math.max(parseFloat(m[1]), parseFloat(m[2]));
    if (resultNum < lo || resultNum > hi) return "ng";
    const third = (hi - lo) / 3;
    const lowerBound = lo + third;
    const upperBound = hi - third;
    if (resultNum < lowerBound) return "ok-lower";
    if (resultNum > upperBound) return "ok-upper";
    return "ok-center";
  }
  if ((m = specTrim.match(new RegExp(`^<=\\s*${num}$`)))) return resultNum <= parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specTrim.match(new RegExp(`^>=\\s*${num}$`)))) return resultNum >= parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specTrim.match(new RegExp(`^<\\s*${num}$`)))) return resultNum < parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specTrim.match(new RegExp(`^>\\s*${num}$`)))) return resultNum > parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specTrim.match(new RegExp(`^=?\\s*${num}$`)))) return resultNum === parseFloat(m[1]) ? "ok" : "ng";

  return "unknown";
}
