/** Utk spec BUKAN rentang (<=, >=, <, >, exact) verdict cuma OK/NG polos. Utk
 * spec RENTANG ("lo-hi") rentang OK-nya dibagi 3 (Lower/Center/Upper).
 *
 * DUPLIKAT SENGAJA dari web/src/lib/specEval.ts -- server & web adalah proyek
 * TS terpisah tanpa package bersama, jaga tetap sinkron manual. 2026-11-11
 * (instruksi eksplisit user, saat bikin RFT di Dashboard Produktivitas):
 * ketahuan salinan server ini sudah TERTINGGAL dari web (belum punya aturan
 * HARDNESS skala pensil, notasi toleransi "40±10", dan normalisasi simbol
 * ≤/≥) -- padahal dipakai label Proses QC & breakdown Dashboard Quality di
 * backend, jadi diam-diam bisa beda verdict dgn yg dilihat user di frontend.
 * Sekarang disamakan PERSIS dgn web, dan `evaluateSpec` (API lama
 * pass/fail/unknown yg dipakai pemanggil2 lama) jadi pembungkus tipis di
 * atas versi detail ini supaya cuma ada 1 implementasi aturan.
 */
export type DetailedSpecVerdict = "ok" | "ok-lower" | "ok-center" | "ok-upper" | "ng" | "unknown";

export type SpecVerdict = "pass" | "fail" | "unknown";

/** Skala kekerasan pensil (pencil hardness), dari paling lunak ke paling
 * keras -- 4H = paling keras/tinggi (2026-08-09, instruksi eksplisit user).
 * Dipakai KHUSUS kalau Item Check mengandung kata "HARDNESS": Result OK
 * kalau kekerasannya >= Spec (mis. Spec "HB" -> HB/F/H/2H/3H/4H = OK,
 * B/2B/3B/4B = NG), bukan dibandingkan sbg angka spt spec lain. */
const HARDNESS_RANK: Record<string, number> = {
  "4B": 0,
  "3B": 1,
  "2B": 2,
  B: 3,
  HB: 4,
  F: 5,
  H: 6,
  "2H": 7,
  "3H": 8,
  "4H": 9,
};

function parseHardnessRank(text: string): number | null {
  const tokens = text.toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
  for (const token of tokens) {
    if (token in HARDNESS_RANK) return HARDNESS_RANK[token];
  }
  return null;
}

// Diurutkan PANJANG-KE-PENDEK ("HB" sebelum "B", "4H" sebelum "H") supaya
// alternation regex di bawah tidak berhenti di token pendek yg salah duluan.
const HARDNESS_TOKEN_ALT = Object.keys(HARDNESS_RANK)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Ganti simbol ≤/≥ (bisa diketik lewat Symbol Picker) jadi <=/>= ASCII. */
function normalizeComparisonSymbols(text: string): string {
  return text.replace(/≤/g, "<=").replace(/≥/g, ">=");
}

function evaluateHardnessStructured(specTrim: string, resultRank: number): DetailedSpecVerdict | null {
  const spec = normalizeComparisonSymbols(specTrim.toUpperCase());
  const tok = `(${HARDNESS_TOKEN_ALT})`;
  let m: RegExpMatchArray | null;
  if ((m = spec.match(new RegExp(`^${tok}\\s*-\\s*${tok}$`)))) {
    const a = HARDNESS_RANK[m[1]];
    const b = HARDNESS_RANK[m[2]];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return resultRank >= lo && resultRank <= hi ? "ok" : "ng";
  }
  if ((m = spec.match(new RegExp(`^<=\\s*${tok}$`)))) return resultRank <= HARDNESS_RANK[m[1]] ? "ok" : "ng";
  if ((m = spec.match(new RegExp(`^>=\\s*${tok}$`)))) return resultRank >= HARDNESS_RANK[m[1]] ? "ok" : "ng";
  if ((m = spec.match(new RegExp(`^<\\s*${tok}$`)))) return resultRank < HARDNESS_RANK[m[1]] ? "ok" : "ng";
  if ((m = spec.match(new RegExp(`^>\\s*${tok}$`)))) return resultRank > HARDNESS_RANK[m[1]] ? "ok" : "ng";
  return null;
}

/** Bagi rentang [lo,hi] jadi 3 sepertiga sama besar (Lower/Center/Upper). */
function evaluateNumericRange(resultNum: number, a: number, b: number): DetailedSpecVerdict {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (resultNum < lo || resultNum > hi) return "ng";
  const third = (hi - lo) / 3;
  const lowerBound = lo + third;
  const upperBound = hi - third;
  if (resultNum < lowerBound) return "ok-lower";
  if (resultNum > upperBound) return "ok-upper";
  return "ok-center";
}

/**
 * Evaluasi hasil cek terhadap string spesifikasi, mis. "40-45" (rentang),
 * "40±10" (toleransi), "<=28", ">=10", "<5", ">5", "≤28", atau angka tunggal
 * (exact match). `itemCheck` opsional -- kalau mengandung kata "HARDNESS",
 * dibandingkan pakai skala pensil (HARDNESS_RANK). SAMA PERSIS dgn
 * `evaluateSpec` di web/src/lib/specEval.ts.
 */
export function evaluateSpecDetailed(
  spec: string | null | undefined,
  result: string | null | undefined,
  itemCheck?: string | null
): DetailedSpecVerdict {
  const specTrim = String(spec ?? "").trim();
  const resultTrim = String(result ?? "").trim();
  if (!specTrim) return "unknown";

  if (String(itemCheck ?? "").toUpperCase().includes("HARDNESS")) {
    const resultRank = parseHardnessRank(resultTrim);
    if (resultRank !== null) {
      const structured = evaluateHardnessStructured(specTrim, resultRank);
      if (structured !== null) return structured;
      const specRank = parseHardnessRank(specTrim);
      if (specRank !== null) return resultRank >= specRank ? "ok" : "ng";
    }
  }

  // Spec tekstual "OK" (mis. Item Check Appearance/visual yg bukan angka).
  if (specTrim.toUpperCase() === "OK") {
    const resultUpper = resultTrim.toUpperCase();
    if (resultUpper === "OK") return "ok";
    if (resultUpper === "NG") return "ng";
    return "unknown";
  }

  const resultNum = parseFloat(resultTrim);
  if (Number.isNaN(resultNum)) return "unknown";

  const specNormalized = normalizeComparisonSymbols(specTrim);
  const num = "(-?\\d+(?:\\.\\d+)?)";
  let m: RegExpMatchArray | null;

  if ((m = specNormalized.match(new RegExp(`^${num}\\s*-\\s*${num}$`)))) {
    return evaluateNumericRange(resultNum, parseFloat(m[1]), parseFloat(m[2]));
  }
  if ((m = specNormalized.match(new RegExp(`^${num}\\s*±\\s*${num}$`)))) {
    const center = parseFloat(m[1]);
    const tolerance = Math.abs(parseFloat(m[2]));
    return evaluateNumericRange(resultNum, center - tolerance, center + tolerance);
  }
  if ((m = specNormalized.match(new RegExp(`^<=\\s*${num}$`)))) return resultNum <= parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^>=\\s*${num}$`)))) return resultNum >= parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^<\\s*${num}$`)))) return resultNum < parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^>\\s*${num}$`)))) return resultNum > parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^=?\\s*${num}$`)))) return resultNum === parseFloat(m[1]) ? "ok" : "ng";

  return "unknown";
}

/** API lama (pass/fail/unknown) utk pemanggil yg tidak butuh pecahan
 * Lower/Center/Upper -- pembungkus tipis `evaluateSpecDetailed`, aturannya
 * SATU. `itemCheck` opsional, sama artinya dgn di versi detail. */
export function evaluateSpec(
  spec: string | null | undefined,
  result: string | null | undefined,
  itemCheck?: string | null
): SpecVerdict {
  const detailed = evaluateSpecDetailed(spec, result, itemCheck);
  if (detailed === "unknown") return "unknown";
  return detailed === "ng" ? "fail" : "pass";
}
