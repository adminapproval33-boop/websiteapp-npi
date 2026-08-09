/** Utk spec BUKAN rentang (<=, >=, <, >, exact) verdict cuma OK/NG polos. Utk spec
 * RENTANG ("lo-hi"), rentang OK-nya dibagi 3 sepertiga sama besar (Lower/Center/Upper)
 * supaya user bisa lihat hasil condong ke batas bawah/tengah/atas spec, bukan cuma OK. */
export type SpecVerdict = "ok" | "ok-lower" | "ok-center" | "ok-upper" | "ng" | "unknown";

export const SPEC_VERDICT_LABEL: Record<SpecVerdict, string> = {
  ok: "OK",
  "ok-lower": "OK Lower",
  "ok-center": "OK Center",
  "ok-upper": "OK Upper",
  ng: "NG",
  unknown: "-",
};

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

/** Ambil token grade kekerasan (mis. "HB", "2H") dari sebuah teks bebas --
 * teks dipecah per token non-alfanumerik supaya spec spt "Min HB" tetap
 * ketemu "HB", bukan cuma exact match string utuh. */
function parseHardnessRank(text: string): number | null {
  const tokens = text.toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
  for (const token of tokens) {
    if (token in HARDNESS_RANK) return HARDNESS_RANK[token];
  }
  return null;
}

/**
 * Evaluasi hasil cek terhadap string spesifikasi, mis. "40-45" (rentang),
 * "<=28", ">=10", "<5", ">5", atau angka tunggal (exact match).
 * Meniru logika pass/fail auto-coloring di versi Apps Script, ditambah pembagian
 * Lower/Center/Upper khusus utk spec rentang. `itemCheck` opsional -- kalau
 * mengandung kata "HARDNESS", dibandingkan pakai skala pensil (lihat
 * HARDNESS_RANK) alih-alih pola numerik/rentang biasa di bawah.
 */
export function evaluateSpec(
  spec: string | null | undefined,
  result: string | null | undefined,
  itemCheck?: string | null
): SpecVerdict {
  const specTrim = String(spec ?? "").trim();
  const resultTrim = String(result ?? "").trim();
  if (!specTrim) return "unknown";

  if (String(itemCheck ?? "").toUpperCase().includes("HARDNESS")) {
    const specRank = parseHardnessRank(specTrim);
    const resultRank = parseHardnessRank(resultTrim);
    if (specRank !== null && resultRank !== null) return resultRank >= specRank ? "ok" : "ng";
  }

  // Spec tekstual "OK" (mis. Item Check Appearance/visual yg bukan angka) --
  // Result dibandingkan sbg teks "OK"/"NG" langsung, bukan diparse jadi angka
  // (2026-08-05, instruksi eksplisit user).
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

export const SPEC_VERDICT_COLOR: Record<SpecVerdict, string> = {
  ok: "#d4f4dd",
  "ok-lower": "#d4f4dd",
  "ok-center": "#d4f4dd",
  "ok-upper": "#d4f4dd",
  ng: "#fbd6d6",
  unknown: "transparent",
};
